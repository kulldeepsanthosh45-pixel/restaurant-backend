-- Supabase Schema for Everdine Restaurant

-- 1. Users Table (Extends Supabase auth.users)
CREATE TABLE public.users (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Admin', 'Customer')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

-- 2. Menu Items Table
CREATE TABLE public.menu_items (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(10, 2) NOT NULL,
  category TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('veg', 'nonveg')) DEFAULT 'veg',
  image_url TEXT,
  is_available BOOLEAN DEFAULT TRUE,
  is_popular BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

-- 3. Orders Table
CREATE TABLE public.orders (
  id SERIAL PRIMARY KEY,
  customer_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  table_no TEXT,
  status TEXT NOT NULL CHECK (status IN ('Pending', 'Preparing', 'Ready', 'Completed', 'Cancelled')) DEFAULT 'Pending',
  total_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  payment_method TEXT DEFAULT 'Cash',
  payment_status TEXT DEFAULT 'Unpaid',
  payment_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

-- 4. Order Items Table
CREATE TABLE public.order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES public.orders(id) ON DELETE CASCADE,
  menu_item_id INTEGER REFERENCES public.menu_items(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  price NUMERIC(10, 2) NOT NULL -- price at the time of order
);

-- 5. Bills Table
CREATE TABLE public.bills (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES public.orders(id) ON DELETE CASCADE,
  subtotal NUMERIC(10, 2) NOT NULL,
  gst NUMERIC(10, 2) NOT NULL,
  total NUMERIC(10, 2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

-- Optional: Set up RLS (Row Level Security) if you want clients to access directly,
-- but since we're using a Node.js backend with service/anon keys, we can leave it disabled
-- or open for the backend to handle authorization.
