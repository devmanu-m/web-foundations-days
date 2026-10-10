# School Database Design

This database stores students, the courses they take, and the grade each student gets on each course. It uses three tables.

## Tables

### students

- Holds one row per student.
- `id` is the primary key.
- `name` is required (NOT NULL).
- `email` is required and UNIQUE, so two students cannot share an email address.

### courses

- Holds one row per course.
- `id` is the primary key.
- `title` and `credits` are required (NOT NULL).

### enrolments

- Holds one row for each student enrolled on a course.
- `id` is the primary key.
- `student_id` is a foreign key to `students(id)` and `course_id` is a foreign key to `courses(id)`. Both are NOT NULL.
- `grade` is an integer from 0 to 100. It can be NULL, which means the student has not been graded yet.
- A UNIQUE rule on (`student_id`, `course_id`) stops the same student enrolling on the same course twice.

## Relationships

- **One student to many enrolments (one-to-many):** one student can have many enrolments, but each enrolment belongs to exactly one student.
- **One course to many enrolments (one-to-many):** one course can have many enrolments, but each enrolment belongs to exactly one course.
- **Students to courses (many-to-many):** one student can take many courses, and one course can have many students. This is the overall relationship, built from the two one-to-many links above.

### Why a join table is needed

A relational table cannot store a list of values in one column, so it is not possible to put a "courses" column in `students` or a "students" column in `courses` without repeating data or breaking the structure. The `enrolments` table solves this. Each row pairs one student with one course, so the many-to-many relationship becomes two simple one-to-many relationships. It also gives a natural place for data that belongs to the pairing itself, which here is the grade.

## Index

I would add an index on `enrolments(course_id)`:

- The UNIQUE rule on (`student_id`, `course_id`) already creates an index that helps when searching by student.
- That index starts with `student_id`, so it does not help much when searching by course alone.
- Queries such as "all students on one course" and "number of students per course" filter and group on `course_id`, so a separate index on `course_id` would keep them fast as the number of enrolments grows.

## SQL or NoSQL?

I would choose SQL for this system. The data is clearly structured and relational: students, courses and enrolments always have the same fields and are linked to each other. SQL enforces those links with foreign keys, prevents bad data with NOT NULL, UNIQUE and CHECK rules, and makes questions like "how many students are on each course?" simple with JOIN and GROUP BY. Accuracy matters for grades and enrolments, and SQL's transactions help keep the data consistent. NoSQL would be a better fit for flexible, rapidly changing data with no fixed shape, or for very large scale, and this system does not need either.