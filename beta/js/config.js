// Public connection settings for the app's Supabase project.
// The publishable key is meant to ship in client code; the database's row-level
// security rules decide what each signed-in angler can read or change.
window.FLYLOG_CONFIG = {
  supabaseUrl: "https://acufuumrjbzbiktodojz.supabase.co",
  supabaseKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFjdWZ1dW1yamJ6YmlrdG9kb2p6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQwNzYyMjEsImV4cCI6MjEwOTY1MjIyMX0.yioLflzuQ3rhUkTZWQWhOAjPXokV4lO_zNnLV-UM_7A",
  dataVersion: "1",
  hdVersion: "1",
  // which copy of the app this is: "stable" for everyone, "beta" for the founder and admins to try first
  channel: "stable",
  build: 20,
  // public half of the web-push key pair (the private half stays on the server)
  vapidPublic: "BAFYgNDOxLjIYZJGPCn-wk0N40Q5vMlgs0Uq6mCCnAzowULN-3TpQMtURzILuAC1_7mPxQVFGODIVHXxe3MZ-LU"
};

// --- test version settings (removed when released) ---
window.FLYLOG_CONFIG.channel = "beta";
window.FLYLOG_CONFIG.dataBase = "../data/";
