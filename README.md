# Code Learner LMS

A full-stack learning management platform with course management, code submission/grading, and plagiarism detection, built as part of ongoing research work on assessment tooling for programming courses.

> **Note on repo structure:** This repository contains two parts. `code-learner-lms-main/lms-app/` is the original application described below — built from scratch (React frontend, Node.js/Express backend, MongoDB). The rest of `code-learner-lms-main/` is a vendored copy of [Moodle](https://moodle.org/), an open-source LMS, included for reference/integration exploration. The Moodle codebase is third-party open-source software, not original work.

## What's in `code-learner-lms-main/lms-app/`

**Backend** (Node.js, Express, MongoDB, JWT auth):
- Course creation and enrollment (`courseController`, `courseRoutes`)
- Code submission handling and grading (`submissionController`, `gradeController`)
- Plagiarism detection across submissions (`plagiarismController`)
- Question/test-case authoring (`questionController`)
- Role-based authentication for students and teachers (`authController`, JWT middleware)

**Frontend** (React, React Router):
- Separate dashboards for students and teachers
- Login/auth flow with persisted sessions
- Course view with live data fetched per role (created courses for teachers, enrolled courses for students)

## Tech Stack
React, React Router, Axios · Node.js, Express.js, MongoDB (Mongoose) · JWT-based authentication

## Status
Actively being developed. Core flows (auth, course management, submissions, grading, plagiarism checks) are implemented; this is ongoing work, not a finished product.

## Running locally
```bash
# Backend
cd code-learner-lms-main/lms-app/backend
npm install
npm run dev

# Frontend
cd code-learner-lms-main/lms-app/frontend
npm install
npm start
```
