-- One bounded global counter. No IP addresses or email addresses are stored here.
CREATE TABLE IF NOT EXISTS auth_mail_budget (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  hour_slot INTEGER NOT NULL,
  day_slot INTEGER NOT NULL,
  hour_count INTEGER NOT NULL,
  day_count INTEGER NOT NULL
);
