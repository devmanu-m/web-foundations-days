-- =====================================================
-- school.sql: students, courses and enrolments (SQLite)
-- =====================================================

PRAGMA foreign_keys = ON;

-- Start clean so this file can be re-run without errors
DROP TABLE IF EXISTS enrolments;
DROP TABLE IF EXISTS courses;
DROP TABLE IF EXISTS students;

-- ---------- 1. Tables ----------

CREATE TABLE students (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE
);

CREATE TABLE courses (
  id      INTEGER PRIMARY KEY,
  title   TEXT NOT NULL,
  credits INTEGER NOT NULL
);

CREATE TABLE enrolments (
  id         INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL,
  course_id  INTEGER NOT NULL,
  grade      INTEGER CHECK (grade IS NULL OR grade BETWEEN 0 AND 100),
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (course_id)  REFERENCES courses(id),
  UNIQUE (student_id, course_id)  -- same student cannot enrol on the same course twice
);

-- ---------- 2. Sample data ----------

INSERT INTO students (id, name, email) VALUES
  (1, 'Grace Wanjiku', 'grace@example.com'),
  (2, 'Brian Otieno',  'brian@example.com'),
  (3, 'Amina Hassan',  'amina@example.com'),
  (4, 'David Kimani',  'david@example.com');

INSERT INTO courses (id, title, credits) VALUES
  (1, 'Web Foundations',       3),
  (2, 'Databases',             4),
  (3, 'Introduction to Python', 3);

-- grade is NULL when the student has not been graded yet
INSERT INTO enrolments (student_id, course_id, grade) VALUES
  (1, 1, 85),
  (1, 2, 78),
  (2, 1, 72),
  (2, 3, 90),
  (3, 1, NULL),
  (3, 2, 88);

-- ---------- 3. Queries ----------

-- Query 1: all courses for one student (by name)
SELECT courses.title, enrolments.grade
FROM students
JOIN enrolments ON enrolments.student_id = students.id
JOIN courses    ON courses.id = enrolments.course_id
WHERE students.name = 'Grace Wanjiku';

-- Query 2: all students on one course
SELECT students.name, students.email
FROM courses
JOIN enrolments ON enrolments.course_id = courses.id
JOIN students   ON students.id = enrolments.student_id
WHERE courses.title = 'Databases';

-- Query 3: number of students per course
SELECT courses.title, COUNT(enrolments.id) AS student_count
FROM courses
LEFT JOIN enrolments ON enrolments.course_id = courses.id
GROUP BY courses.id, courses.title;

-- Query 4: students who have no enrolments
SELECT students.name, students.email
FROM students
LEFT JOIN enrolments ON enrolments.student_id = students.id
WHERE enrolments.id IS NULL;

-- Query 5: update one enrolment's grade (Amina's grade in Web Foundations)
UPDATE enrolments
SET grade = 92
WHERE student_id = (SELECT id FROM students WHERE name = 'Amina Hassan')
  AND course_id  = (SELECT id FROM courses  WHERE title = 'Web Foundations');

-- Check that the update worked
SELECT students.name, courses.title, enrolments.grade
FROM enrolments
JOIN students ON students.id = enrolments.student_id
JOIN courses  ON courses.id  = enrolments.course_id
WHERE students.name = 'Amina Hassan';