# Gemini Project Context: School Schedule Web Application

## Project Overview

This project is a web application for managing a school schedule. It features a React frontend, a Node.js/Express backend, and uses `db.json` as a simple database.

**Key Functionality Implemented:**

*   **Full CRUD for Schedule Events:** Users can create, read, update, and delete schedule events.
*   **Advanced Data Management (Subjects, Teachers, Rooms):**
    *   Modals for adding, renaming, deleting, and reordering subjects, teachers, and rooms.
    *   Deletion is prevented if an item is in use in the schedule.
    *   "Find Usages" feature to list dates an item is used, with an option to delete all entries for that item on a specific day.
    *   Reordering via drag-and-drop, saved with an `order` property.
*   **UI Improvements:**
    *   `AppBar` buttons are grouped into a "MENU" dropdown for a cleaner interface. The "Add Event" button remains separate.
    *   Teacher filter dropdown added next to the week selection, allowing users to view schedules filtered by a specific teacher.
*   **Lesson Counter Feature:**
    *   A "Lesson Counter" button in the "MENU" opens a modal.
    *   Users can select a date range, a teacher, and an optional subject.
    *   The modal displays the total number of hours a teacher has taught, counting multiple mentions in the same time slot as 1 hour.
*   **Export to PDF:** Functionality to export the schedule to PDF.
*   **Copy/Paste Schedule:** Features to copy a day's or a week's schedule to another date.
*   **Authentication:** Google OAuth for user login.
*   **Email Schedule Feature:**
    *   "Send Mail" button in the "MENU" opens a modal.
    *   Users can compose an email body and select recipients (all teachers or individual teachers).
    *   The system generates a PDF of the *currently viewed week's schedule* (general or specific teacher's view) on the client-side.
    *   This client-generated PDF is sent to the backend, which then sends the email with the PDF as an attachment.
    *   The email subject and PDF filename are dynamically generated.

## Building and Running

The project consists of a `client` (React frontend) and a `server` (Node.js/Express backend).

**1. Backend Setup:**

```bash
cd ProjectSKISTT/server
npm install
node server.js
```

**2. Frontend Setup:**

```bash
cd ProjectSKISTT/client
npm install
# No specific run command for client as it's served by the backend after build
```

**3. Running the Application:**

Start the backend server first, then open `ProjectSKISTT/client/index.html` in a web browser.

## Development Conventions

*   **Frontend:** React with Material-UI.
*   **Backend:** Node.js with Express.js.
*   **Data Storage:** `db.json` (JSON-server).
*   **Code Structure:** Follows a component-based approach for the frontend.
*   **State Management:** React's `useState` and `useEffect` hooks.
*   **API Interaction:** `fetch` API for communication with the backend.
