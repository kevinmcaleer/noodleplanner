--- 
title: Sample Project
project manager: Kevin
Resources:
- @Andy: Andy Mcarthy, Lead Developer
- @Bob: Bob Smith, Developer, 50%
- @Charlie: Charlie Brown, QA Engineer
- @Diana: Diana Prince, Product Owner
- @Frank: Frank Castle, DevOps Engineer
- @Eve: Eve Adams, Project Coordinator

Holidays:
- 2025-12-25
- 2025-12-26
---

Project
  Requirements
    capture requirements @Alice 3days 50% "Interviews with stakeholders" 2025-10-01
  Design
    Low Level Design @Andy 2days [depends capture requirements] "with signoff"
  Build
    develop software @Bob 5days [depends Low Level Design] "agile development"
  Test
    test plan @Charlie 3days [depends develop software]
    * system testing @Charlie @Andy 4days
    * user acceptance testing @Diana 2days
    * Testing Complete 0d
  Deploy
    go-no-go decision @Eve 1day [depends user acceptance testing]
    * go live @Frank 1day "final decision"
    * Deploy Complete 0d "product now live"
  Support
    hypercare @Grace 7days [depends go live] "24/7 support provided for 1 week"
