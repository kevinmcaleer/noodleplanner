---
title: Dependency Types
---
Phase A
  Design 3d
  Build 5d [depends Design]
  Test 2d [depends Build:SS]
  Sign-off 1d [depends Test:FF]
  Review 2d [depends Sign-off:SF]
Phase B
  Lagged 2d [depends Build +2d]
  Leading 3d [depends Build -1d]
  Weeks 1d [depends Build +1w]
  Mixed 2d [depends Design:SS +3d, Build:FF -2d]
