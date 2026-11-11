-- Every photo link request failed from Nov 9 evening: the photo access rule calls private.in_trip,
-- which signed-in users were not allowed to run, so the whole check errored. It only answers "is this person on this trip".
grant execute on function private.in_trip(uuid, uuid) to authenticated;
