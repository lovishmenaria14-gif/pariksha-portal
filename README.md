# 📝 Pariksha – Online Examination Platform

**Pariksha** is a web-based online examination platform designed to simplify and modernize the examination process. It enables students to attempt online examinations, track their performance, and view results, while administrators can manage examinations, questions, candidates, and overall exam activities.

The platform aims to provide a smooth, secure, and efficient digital examination experience.

🌐 **Live Demo:** https://pariksha-portal.vercel.app/

---

## ✨ Features

### 👨‍🎓 Student Panel
- Secure user authentication.
- Browse and access available examinations.
- Attempt online mock tests.
- Real-time examination timer.
- Support for MCQ and numerical-based questions.
- Automatic evaluation and score calculation.
- Configurable marking schemes (positive and negative marking).
- View examination results and performance.
- Track examination attempts.

### 🛠️ Admin Dashboard
- Centralized admin dashboard.
- Create and manage examinations.
- Configure examination duration and settings.
- Add and manage questions.
- Support for multiple question types.
- Configure marking schemes.
- Manage examination attempts.
- Monitor candidates and examination statistics.

### 🔐 Security & Reliability
- Authentication and protected API routes.
- Server-side examination evaluation.
- MongoDB-based data persistence.
- Configurable examination violation limits.
- Secure handling of environment variables.
- Backend API validation.

---

## 🧰 Tech Stack

| Technology | Purpose |
|---|---|
| HTML, CSS, JavaScript | Frontend |
| Node.js | Backend runtime |
| Express.js | REST API |
| MongoDB | Database |
| Firebase Admin SDK | Authentication integration |
| Vercel | Deployment |
| Git & GitHub | Version control |

---

## 📂 Project Structure

```text
pariksha-portal/
│
├── public/
│   └── assets/
│
├── src/
│   ├── server.js
│   ├── routes/
│   ├── controllers/
│   ├── models/
│   └── middleware/
│
├── frontend/
│   ├── pages/
│   ├── components/
│   ├── api.js
│   └── dom.js
│
├── package.json
├── package-lock.json
├── vercel.json
├── .gitignore
└── README.md
```

*Note: Directory names may vary depending on the latest project structure.*

---

## 🚀 Getting Started

Follow these steps to run Pariksha locally.

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/pariksha-portal.git
```

### 2. Navigate to the Project

```bash
cd pariksha-portal
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Configure Environment Variables

Create a `.env` file in the project root.

```env
PORT=3000
MONGODB_URI=your_mongodb_connection_string
GOOGLE_APPLICATION_CREDENTIALS=path_to_firebase_service_account.json
```

Add any other Firebase or application-specific environment variables required by your configuration.

**Important:** Never upload your `.env` file or Firebase service account credentials to GitHub.

### 5. Start the Application

```bash
npm start
```

For development:

```bash
npm run dev
```

*Use the scripts configured in your package.json.*

---

## ⚙️ Examination Configuration

Pariksha supports configurable examination settings, including:

- Examination title and description.
- Examination duration.
- Question shuffling.
- Maximum allowed violations.
- Multiple question types.
- Positive and negative marking.

Example examination configuration:

```json
{
  "code": "MOCK-01",
  "title": "JEE Main Mock Test",
  "durationMin": 180,
  "shuffleQuestions": false,
  "maxViolations": 0,
  "scheme": {
    "MCQ": {
      "correct": 4,
      "wrong": -1
    },
    "NUMERICAL": {
      "correct": 4,
      "wrong": 0
    }
  }
}
```

---

## 🌍 Deployment

The application is deployed using **Vercel**.

To deploy your own instance:

1. Fork or clone this repository.
2. Import the repository into Vercel.
3. Configure the required environment variables.
4. Connect your MongoDB database.
5. Configure Firebase credentials securely.
6. Deploy the application.

Make sure all production environment variables are configured before deployment.

---

## 🔒 Environment & Security

For security reasons:

- Never commit `.env` files.
- Never expose Firebase service account private keys.
- Keep MongoDB credentials private.
- Protect administrative routes.
- Validate examination submissions on the server.
- Do not trust client-side score calculations.

---

## 🤝 Contributing

Contributions are welcome!

If you want to improve Pariksha:

1. Fork the repository.
2. Create a new branch.

```bash
git checkout -b feature/your-feature
```

3. Make your changes.
4. Commit your changes.

```bash
git commit -m "Add: your feature"
```

5. Push your branch.

```bash
git push origin feature/your-feature
```

6. Open a Pull Request.

---

## 🎯 Project Objective

The objective of Pariksha is to make online examinations more accessible, organized, and efficient by providing students and administrators with a unified examination management platform.

---

## 📜 License

This project is open-source. You may use, modify, and distribute it in accordance with the terms of the license included in this repository.

---

<p align="center">
  <b>Built with ❤️ to make online examinations simpler and smarter.</b>
</p>
