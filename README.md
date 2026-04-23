# Luxe MC Server

Missed-Call SMS Booking System for Luxe Nail Spa

## Features

- **Express TypeScript Server**: Robust API server with request logging
- **Supabase Integration**: Database client with service role key authentication
- **Webhook Security**: Ed25519 signature verification and replay protection for Telnyx webhooks
- **Missed Call Detection**: Automatically detects missed calls and sends welcome SMS
- **Google Calendar Integration**: Creates real calendar events for bookings using service account authentication
- **Natural Language Time Parsing**: Understands user input like "3pm", "tomorrow 2pm", "next Monday 10am"
- **Business Hours Guard**: Blocks bookings outside salon hours (configurable)
- **Availability Checking**: Checks calendar for conflicts and suggests alternative times
- **Booking Confirmation SMS**: Sends confirmation immediately after booking with cancel/reschedule options
- **Automated Reminders**: 24-hour and 1-hour reminder SMS via scheduled cron job
- **Cancel Handling**: Deletes calendar event, marks appointment cancelled, and clears conversation
- **Menu Auto-Reply**: MENU/PRICE keywords return service menu with prices without changing conversation state
- **Follow-up SMS**: Automatically sends re-engagement SMS after 15 minutes of inactivity in early booking states
- **Auto-fill Slots**: Sends slot offers to eligible missed callers when appointments are cancelled (24h cooldown, rate-limited)
- **Health Checks**: Built-in health endpoint and startup connectivity checks

## Quick Start

### Prerequisites

- Node.js >= 20.0.0
- npm or yarn
- Supabase project with service role key

### Installation

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Edit .env with your Supabase credentials
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | 3000 | Server port |
| `NODE_ENV` | No | development | Environment mode |
| `SUPABASE_URL` | Yes | - | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | - | Supabase service role key |
| `LOG_LEVEL` | No | info | Logging level |
| `TELNYX_API_KEY` | Yes | - | Telnyx API key for sending SMS |
| `TELNYX_WEBHOOK_PUBLIC_KEY` | Yes | - | Telnyx Ed25519 public key for webhook signature verification |
| `TELNYX_PHONE_NUMBER` | No | - | Your Telnyx phone number for sending SMS (E.164 format) |
| `WELCOME_SMS_TEMPLATE` | No | Welcome to Luxe Nail Spa! Book your appointment... | SMS template for welcome messages |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | No* | - | Google service account credentials (JSON string). Required for calendar bookings. |
| `GOOGLE_CALENDAR_ID` | No | primary | Google Calendar ID to create events in |
| `SALON_TIMEZONE` | No | America/New_York | Salon timezone for time parsing and calendar events |
| `SALON_BUSINESS_HOURS` | No | 0:,1:9-19,2:9-19,3:9-19,4:9-19,5:9-19,6:9-17 | Business hours (day:open-close, 0=Sun, empty=closed) |
| `SMS_RATE_LIMIT_PER_DAY` | No | 3 | Max outbound auto-fill offers per phone number per day |
| `AUTO_FILL_COOLDOWN_HOURS` | No | 24 | Hours between auto-fill offers to the same number |

*Required for full booking functionality. Without it, the system will still handle SMS conversations but won't create calendar events.

### Running the Server

```bash
# Development mode with hot reload
npm run dev

# Production build and start
npm run build
npm start
```

## API Endpoints

### Health Check

```
GET /health
```

Returns server health status.

### Hello World

```
GET /api/hello
```

Returns a simple Hello World message.

**Response:**
```json
{
  "message": "Hello World"
}
```

### Webhooks

#### Telnyx Call Webhook

```
POST /webhook/telnyx/call
```

Receives call events from Telnyx.

#### Telnyx SMS Webhook

```
POST /webhook/telnyx/sms
```

Receives SMS events from Telnyx.

## Testing

```bash
# Run unit tests
npm test

# Run integration tests
npm run test:integration

# Run tests in watch mode
npm run test:watch
```

## Project Structure

```
├── src/
│   ├── config/
│   │   └── env.ts              # Environment validation
│   ├── lib/
│   │   ├── logger.ts           # Pino logger with redaction
│   │   ├── supabase.ts         # Supabase client
│   │   ├── calendar.ts         # Google Calendar integration
│   │   ├── time-parser.ts      # Natural language time parsing (chrono-node)
│   │   ├── business-hours.ts   # Business hours validation
│   │   ├── conversation-state.ts # SMS conversation state machine
│   │   ├── conversation-service.ts # Conversation persistence
│   │   ├── appointment-service.ts # Appointment CRUD operations
│   │   ├── reminder-service.ts  # Cron job for reminders
│   │   ├── missed-call.ts      # Missed call detection
│   │   └── telnyx-sms.ts       # Telnyx SMS sending
│   ├── middleware/
│   │   ├── logging.ts          # Request logging middleware
│   │   └── webhook-verification.ts # Ed25519 signature verification
│   ├── routes/
│   │   └── webhooks.ts         # Webhook route handlers
│   ├── types/
│   │   └── index.ts            # TypeScript types
│   └── index.ts                # Server entry point
├── tests/
│   ├── unit/                   # Unit tests
│   └── integration/            # Integration tests
├── package.json
├── tsconfig.json
└── .env.example
```

## Definition of Done

- [x] Server runs on port 3000 with request logging and JSON parsing
- [x] Supabase client initializes with service role key and passes startup check
- [x] Webhook stubs return 200 OK with a success payload
- [x] Missing env vars fail startup with a clear error
- [x] Supabase connection failure logs and exits non-zero
- [x] Webhook stubs respond in under 200ms
- [x] Secrets are never logged and request body size is limited
- [x] Google Calendar integration authenticates via service account JSON
- [x] Natural language time parsing converts input like "3pm" to valid times
- [x] Business hours guard blocks outside-hours bookings with helpful error
- [x] Calendar availability checking suggests alternative times when busy
- [x] Booking confirmation creates real calendar events with event IDs
- [x] Booking confirmation SMS sent immediately after booking creation
- [x] 24-hour and 1-hour reminder SMS via node-cron (runs every 5 minutes)
- [x] CANCEL keyword deletes calendar event, marks appointment cancelled, clears conversation
- [x] Reminder flags (reminder_sent_24h, reminder_sent_1h) prevent duplicate sends
- [x] MENU/PRICE keywords return menu text without state change
- [x] Follow-up SMS sends after 15 minutes of inactivity in early states
- [x] Auto-fill sends slot offers to eligible missed callers after cancellations
- [x] Follow-up is sent only once per conversation (follow_up_sent tracking)
- [x] Auto-fill skips callers already booked or recently contacted
- [x] Auto-fill respects 24h cooldown and daily rate limits
