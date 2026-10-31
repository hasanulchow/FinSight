-- FinSight migration 009: short selling in the practice account (for bear flag bots and manual shorts).
-- Run in the Supabase SQL editor AFTER 008. Safe to re-run.

-- Positions can be negative (short)
alter table public.paper_positions drop constraint if exists paper_positions_qty_check;
alter table public.paper_positions add constraint paper_positions_qty_check check (qty <> 0);

-- Orders can sell short
alter table public.paper_orders drop constraint if exists paper_orders_side_check;
alter table public.paper_orders add constraint paper_orders_side_check check (side in ('buy', 'sell', 'short'));
