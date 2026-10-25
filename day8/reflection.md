# Reflection

## The most difficult concept

The hardest idea for me was scope in JavaScript, and I learned it the hard way in Project 1. I accidentally pasted a second version of `render()` inside the form submit listener, so new notes did not appear and the search did not filter. I overcame it by searching my file for duplicate function names, checking the indentation, and replacing the whole file instead of patching it in pieces. Now I check that every function sits at the top level before I test.

## What I would improve

Based on my Project 2 feedback, I would improve the single points of failure section of my QuickNotes architecture. The reviewer pointed out that I should explain how to stop the load balancer from being a single point of failure. I would describe an active-passive pair that shares a virtual IP, so one takes over when the other fails, and DNS failover in case a whole data centre goes down. I would also expand my read replica trade-off to show how a user can briefly miss a note they just created.

## What I will learn next

I want to build a real back end with Node.js and a SQL database, so the API I designed exists instead of a practice API. After that I want to learn testing and deployment, so I can put my projects online and be confident they still work when I change them.