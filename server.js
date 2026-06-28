require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// ==========================
// 1. AUTHENTICATION
// ==========================

// Signup
app.post('/api/auth/signup', async (req, res) => {
  const { email, password, name, role } = req.body;
  if (!email || !password || !name || !role) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // 1. Sign up user in Supabase Auth
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
  });

  if (authError) return res.status(400).json({ error: authError.message });
  if (!authData.user) return res.status(400).json({ error: 'Failed to create user' });

  // 2. Insert into public.users table
  const { data: userData, error: dbError } = await supabase
    .from('users')
    .insert([{ id: authData.user.id, name, email, role }])
    .select()
    .single();

  if (dbError) return res.status(400).json({ error: dbError.message });

  res.status(201).json({ message: 'User created successfully', user: userData });
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (authError) return res.status(401).json({ error: authError.message });

  // Get user details from public.users
  const { data: userData, error: dbError } = await supabase
    .from('users')
    .select('*')
    .eq('id', authData.user.id)
    .single();

  if (dbError) return res.status(400).json({ error: dbError.message });

  res.json({ message: 'Login successful', session: authData.session, user: userData });
});


// ==========================
// 2. MENU MANAGEMENT
// ==========================

// Get all menu items
app.get('/api/menu', async (req, res) => {
  const { data, error } = await supabase.from('menu_items').select('*').order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Add menu item (Admin only logic normally, keeping it simple for now)
app.post('/api/menu', async (req, res) => {
  const { name, description, price, category, type, image_url, is_available } = req.body;
  const { data, error } = await supabase
    .from('menu_items')
    .insert([{ name, description, price, category, type, image_url, is_available }])
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

// Edit menu item
app.put('/api/menu/:id', async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const { data, error } = await supabase
    .from('menu_items')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Delete menu item
app.delete('/api/menu/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('menu_items').delete().eq('id', id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Menu item deleted successfully' });
});


const crypto = require('crypto');
const Razorpay = require('razorpay');

// Initialize Razorpay
// Note: You must add these keys to your .env file
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_YOUR_KEY_HERE',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'YOUR_SECRET_HERE',
});

// ==========================
// 3. ORDERS & PAYMENTS
// ==========================

// Create Order (with items)
app.post('/api/orders', async (req, res) => {
  const { customer_id, table_no, items, payment_method } = req.body;
  
  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'Order must contain items' });
  }

  // Calculate total amount in INR
  const total_amount = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const gst = total_amount * 0.05;
  const final_total = total_amount + gst;

  // 1. Insert Order into Supabase
  const { data: orderData, error: orderError } = await supabase
    .from('orders')
    .insert([{ 
      customer_id, 
      table_no, 
      status: 'Pending', 
      total_amount: final_total,
      payment_method: payment_method || 'Cash',
      payment_status: payment_method === 'Online' ? 'Pending' : 'Unpaid'
    }])
    .select()
    .single();

  if (orderError) return res.status(400).json({ error: orderError.message });

  // 2. Insert Order Items
  const orderItems = items.map(item => ({
    order_id: orderData.id,
    menu_item_id: item.menu_item_id,
    quantity: item.quantity,
    price: item.price
  }));

  const { error: itemsError } = await supabase.from('order_items').insert(orderItems);
  if (itemsError) return res.status(400).json({ error: itemsError.message });

  // 3. If Online Payment, generate Razorpay Order
  if (payment_method === 'Online') {
    try {
      const rzpOrder = await razorpay.orders.create({
        amount: Math.round(final_total * 100), // Amount in paise
        currency: 'INR',
        receipt: `receipt_order_${orderData.id}`,
      });
      return res.status(201).json({ 
        message: 'Order created', 
        order: orderData,
        razorpay_order: rzpOrder,
        key_id: process.env.RAZORPAY_KEY_ID
      });
    } catch (err) {
      console.error('Razorpay Error:', err);
      return res.status(500).json({ error: 'Failed to create payment gateway order' });
    }
  }

  // Return standard response for Cash
  res.status(201).json({ message: 'Order placed successfully', order: orderData });
});

// Verify Payment Signature
app.post('/api/payment/verify', async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, order_id } = req.body;
  const secret = process.env.RAZORPAY_KEY_SECRET || 'YOUR_SECRET_HERE';
  
  // Verify Signature
  const shasum = crypto.createHmac('sha256', secret);
  shasum.update(`${razorpay_order_id}|${razorpay_payment_id}`);
  const digest = shasum.digest('hex');

  if (digest === razorpay_signature) {
    // Payment Successful - Update Database
    const { data, error } = await supabase
      .from('orders')
      .update({ payment_status: 'Paid', payment_id: razorpay_payment_id })
      .eq('id', order_id);
      
    if (error) {
      return res.status(500).json({ status: 'Payment successful but DB update failed', error: error.message });
    }
    res.json({ status: 'ok', message: 'Payment verified successfully' });
  } else {
    res.status(400).json({ status: 'error', message: 'Invalid signature' });
  }
});

// Get all orders (for admin dashboard)
app.get('/api/orders', async (req, res) => {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      *,
      order_items ( *, menu_items(*) ),
      users ( name )
    `)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Update order status
app.put('/api/orders/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const { data, error } = await supabase
    .from('orders')
    .update({ status })
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});


// ==========================
// 4. BILLING (Checkout)
// ==========================

// Generate Bill
app.post('/api/checkout', async (req, res) => {
  const { order_id } = req.body;

  // Fetch the order
  const { data: orderData, error: orderError } = await supabase
    .from('orders')
    .select('*')
    .eq('id', order_id)
    .single();

  if (orderError) return res.status(400).json({ error: orderError.message });
  if (!orderData) return res.status(404).json({ error: 'Order not found' });

  // Calculate taxes (e.g. 5% GST)
  const subtotal = parseFloat(orderData.total_amount);
  const gst = subtotal * 0.05;
  const total = subtotal + gst;

  // Insert Bill
  const { data: billData, error: billError } = await supabase
    .from('bills')
    .insert([{ order_id, subtotal, gst, total }])
    .select()
    .single();

  if (billError) return res.status(400).json({ error: billError.message });

  // Update order status to completed
  await supabase.from('orders').update({ status: 'Completed' }).eq('id', order_id);

  res.status(201).json({ message: 'Checkout successful, bill generated', bill: billData });
});


// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
