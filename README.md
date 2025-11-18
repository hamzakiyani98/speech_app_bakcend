# Speech App Backend

A comprehensive backend API for a speech and document processing application with features including text-to-speech, OCR, AI processing, and more.

## 📁 Project Structure

```
speech_app_bakcend/
├── config/                 # Configuration files
│   ├── constants.js       # Application constants
│   ├── cronJobs.js        # Scheduled tasks configuration
│   ├── database.js        # Database connection pool
│   └── services.js        # Third-party services initialization
│
├── controllers/           # Request handlers
│   ├── adminController.js
│   ├── adsController.js
│   ├── authController.js
│   ├── chatController.js
│   ├── documentsController.js
│   ├── healthController.js
│   ├── notificationsController.js
│   ├── paymentsController.js
│   ├── readingSessionsController.js
│   ├── statisticsController.js
│   ├── supportController.js
│   └── ttsController.js
│
├── middleware/            # Express middleware
│   ├── auth.js           # Authentication middleware
│   ├── featureAccess.js  # Feature access control
│   └── upload.js         # File upload configuration
│
├── models/                # Database models and initialization
│   └── database.js       # Database schema initialization
│
├── routes/                # API route definitions
│   ├── adminRoutes.js
│   ├── adsRoutes.js
│   ├── authRoutes.js
│   ├── chatRoutes.js
│   ├── documentsRoutes.js
│   ├── healthRoutes.js
│   ├── notificationsRoutes.js
│   ├── paymentsRoutes.js
│   ├── readingSessionsRoutes.js
│   ├── statisticsRoutes.js
│   ├── supportRoutes.js
│   └── ttsRoutes.js
│
├── utils/                 # Utility functions
│   ├── adminLogger.js    # Admin action logging
│   ├── aiProcessing.js   # OpenAI API utilities
│   ├── chatbot.js        # Chatbot response generation
│   ├── email.js          # Email and OTP utilities
│   ├── fileExtraction.js # PDF/DOCX/TXT extraction
│   ├── imageProcessing.js# Image preprocessing and OCR
│   ├── notifications.js  # Push notification utilities
│   ├── ocrQuota.js       # OCR quota management
│   ├── statistics.js     # User statistics and tracking
│   ├── ttsHelpers.js     # TTS helper functions
│   ├── urlExtraction.js  # URL content scraping
│   └── voiceCommands.js  # Voice command processing
│
├── public/                # Static files
│   └── ads-images/       # Advertisement images
│
├── .env.example          # Environment variables template
├── .gitignore           # Git ignore rules
├── package.json         # NPM dependencies
└── server.js            # Main application entry point
```

## 🚀 Getting Started

### Prerequisites

- Node.js (v14 or higher)
- MySQL database
- Google Cloud credentials for TTS
- Firebase credentials for push notifications
- OpenAI API key

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd speech_app_bakcend
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your credentials
```

4. Place service account keys:
- `service-account-key.json` - Google Cloud TTS credentials
- `service-account-key2.json` - Firebase Admin SDK credentials

5. Start the server:
```bash
npm start
```

The server will run on `http://localhost:3000` by default.

## 📋 Features

### Authentication
- User signup and login
- OTP-based email verification
- JWT token authentication
- 3-day trial for new users

### Text-to-Speech (TTS)
- Google Cloud Neural2 voices
- Multiple language support
- Adjustable speech rate
- Voice gender options

### Document Management
- Upload PDF, DOCX, TXT, images
- Camera-based document capture
- OCR processing (Tesseract & Google Cloud Vision)
- URL content extraction
- Document organization and search

### AI Features
- Document summarization
- Action point extraction
- Decision support analysis
- Language translation
- Voice command processing
- AI-powered chatbot

### Notifications
- Push notifications (Firebase Cloud Messaging)
- Email notifications
- In-app notifications
- Notification preferences
- Delivery tracking

### Reading Sessions
- Track reading progress
- Save reading positions
- Reading statistics
- Reading goals
- Achievement system
- Reading streak tracking

### Subscription & Payments
- Free, Trial, and Premium plans
- Payment processing
- Subscription management
- Feature limits enforcement
- Refund handling

### Admin Panel
- User management
- Content moderation
- Analytics and reporting
- System settings
- Advertisement management
- Support ticket system
- Feature flags
- System health monitoring

## 🔒 API Endpoints

### Health Check
- `GET /` - API information
- `GET /api/test` - Health check
- `GET /api/health` - Health status

### Authentication
- `POST /api/signup` - User registration
- `POST /api/login` - User login
- `POST /api/auth/signup/request-otp` - Request signup OTP
- `POST /api/auth/login/request-otp` - Request login OTP
- `POST /api/auth/signup/verify-otp` - Verify signup OTP
- `POST /api/auth/login/verify-otp` - Verify login OTP
- `POST /api/auth/resend-otp` - Resend OTP

### Text-to-Speech
- `GET /api/tts/test` - TTS health check
- `POST /api/tts/synthesize` - Synthesize speech
- `GET /api/tts/voices` - List available voices

### Documents
- `POST /api/documents` - Upload document
- `GET /api/documents` - List user documents
- `GET /api/documents/:id` - Get document details
- `POST /api/documents/:id/summarize` - Summarize document
- `POST /api/documents/:id/translate` - Translate document
- And many more...

### Admin
- `POST /api/admin/setup` - Setup admin account
- `POST /api/admin/login` - Admin login
- `GET /api/admin/dashboard` - Dashboard overview
- `GET /api/admin/users` - List users
- And many more...

## 🗄️ Database

The application uses MySQL with the following main tables:
- `users` - User accounts
- `documents` - Document storage
- `chat_sessions` & `chat_messages` - Chat functionality
- `notifications` & `user_device_tokens` - Notification system
- `reading_sessions` - Reading tracking
- `pricing_plans` & `user_payments` - Subscription management
- `admin_users` & `admin_logs` - Admin functionality
- `ads` - Advertisement management
- `support_requests` - Support tickets
- And more...

## 🔧 Configuration

### Environment Variables

See `.env.example` for required environment variables.

### Database Connection

Configure in `config/database.js` or via environment variables.

### Third-party Services

- **OpenAI**: Set `OPENAI_API_KEY` in `.env`
- **Google Cloud TTS**: Place credentials in `service-account-key.json`
- **Firebase**: Place credentials in `service-account-key2.json`
- **Email**: Configure Gmail credentials in `.env`

## 📦 Dependencies

Major dependencies include:
- `express` - Web framework
- `mysql2` - MySQL client
- `jsonwebtoken` - JWT authentication
- `@google-cloud/text-to-speech` - Google TTS
- `openai` - OpenAI API
- `firebase-admin` - Firebase push notifications
- `tesseract.js` - OCR processing
- `pdf-parse` - PDF extraction
- `mammoth` - DOCX extraction
- And more...

## 🤝 Contributing

This is a refactored backend with proper separation of concerns:
- Controllers handle business logic
- Routes define API endpoints
- Middleware handles cross-cutting concerns
- Utils contain reusable functions
- Models manage database operations

## 📄 License

ISC

## 🙏 Acknowledgments

- Google Cloud Platform for TTS and Vision APIs
- OpenAI for ChatGPT API
- Firebase for push notifications
- All the open-source libraries used in this project
