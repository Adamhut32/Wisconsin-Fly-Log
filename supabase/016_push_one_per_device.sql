-- One notification sign-up per device. The live app and the test copy each had their own sign-up on the same phone,
-- so every notification arrived twice. The app now tags each sign-up with a device id and replaces the old one.
alter table public.push_subscriptions add column if not exists device_id text check (device_id is null or char_length(device_id) <= 80);
create index if not exists push_subscriptions_device on public.push_subscriptions (user_id, device_id);
