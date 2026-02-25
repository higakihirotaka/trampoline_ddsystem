# Blueprint: Trampoline Competition Card System

## Overview

This project is a web-based application designed to manage and display competition cards for trampoline athletes. It allows tournament organizers to manage events and athletes, and for athletes to submit their routines online. The system provides real-time updates and clear displays for various stakeholders (judges, coaches, athletes).

---

## Features & Design

### 1. Data Structure

#### 1.1. Tournament Data (`/tournaments/{eventId}`)

- `name`, `startDate`, `endDate`: Basic tournament information.
- `submissionDeadline`, `revisionDeadline`, `finalSubmissionDeadline`: Various deadlines.
- `classRules`: An object containing specific rules for each competition class. 
    - **key:** The name of the class (e.g., "Aクラス").
    - **value:** An object with the following rule fields:
        - `qualifyingRoutines`: Number of routines in the qualifying round (1 or 2).
        - `qualifyingScoring`: Method to determine the score from preliminaries (`total` or `best`).
        - `hasFinal`: Boolean, true if there is a final round.
        - `advancementCount`: Number of athletes advancing to the final.
        - `numExecJudges`: The number of execution judges (2, 4, or 6).

#### 1.2. Athlete Data (`/tournaments/{eventId}/athletes/{athleteId}`)

- `class`, `gender`, `flightGroup`, `order`: Core identifiers for grouping and sorting.
- `name1`, `kana1`, `club1`, `clubKana1`: Athlete and team names.
- `isWithdrawn`: Flag for athlete withdrawal.

### 2. Admin Pages

- **`admin_index.html`:** The entry point for administrators.
- **`admin_menu.html`:** A central portal providing access to all administrative functions. Now includes a link to the new "Class-Specific Rules" page.
- **`settings.html` (General Settings):** Manages *overall* tournament parameters like name, dates, and deadlines. Competition-specific rules have been moved to their own dedicated page.
- **`class_rules.html` (Class-Specific Rules):**
    - **New Page:** A dedicated interface to manage rules for each class.
    - Automatically detects all unique classes from the athlete roster.
    - For each class, administrators can set: 
        - Qualifying routines, scoring method, final round existence, advancement count, and the number of judges.
    - All settings are saved under the `classRules` map in the main tournament document.
- **`athlete_management.html` (Athlete Roster Management):** 
    - **Bulk Deletion:** Users can now select multiple athletes via checkboxes and delete them in a single action with a confirmation modal.
    - **Custom Confirmation Modal:** Replaced the native browser `confirm()` with a custom, consistently styled modal for all deletion actions (single and bulk) to ensure reliable behavior across all development environments.

### 3. User-Facing Pages

- **`index.html` (Home Page):** Main entry point. Displays a list of active tournaments.
- **`event.html` (Athlete & Event List):** Displays all participating athletes for a selected tournament. The list is sorted by class, gender, group, and order.
- **`entry.html` (Skill Entry Page):** Allows an athlete to input a routine.

---

## Current Plan: Implement Class-Specific Competition Rules

**Purpose:** To enable administrators to define different competition rules for different classes within the same tournament, offering greater flexibility for complex event formats.

### Steps Completed:

1.  **Created `class_rules.html`:**
    - Developed a new, dedicated page for managing rules on a per-class basis.
    - The page dynamically generates configuration cards for each unique class found in the athlete roster.
    - Implemented logic to save these rules into a `classRules` map within the main tournament data structure in Firestore.

2.  **Updated `admin_menu.html`:**
    - Added a new card to the admin menu, linking directly to the `class_rules.html` page for easy access.

3.  **Refactored `settings.html`:**
    - Removed `qualifyingRoutines`, `hasFinal`, and `numExecJudges` from the general settings page to avoid redundancy and confusion.
    - The page is now streamlined to manage only the tournament's overall basic information and deadlines.

4.  **Enhanced `athlete_management.html`:**
    - Implemented a bulk deletion feature using checkboxes, allowing for the efficient removal of multiple athletes.
    - Replaced all native JavaScript `confirm()` dialogs with a custom HTML/CSS/JS modal to ensure a consistent and reliable user experience, especially in modern development environments where pop-ups can be suppressed.

This major update successfully modularizes the competition rule settings, making the system significantly more powerful and adaptable for diverse tournament needs.
