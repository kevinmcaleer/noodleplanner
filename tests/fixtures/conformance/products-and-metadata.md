---
title: Products and Metadata
Resources:
- @kev: Kevin McAleer, Project Manager
- @adam: Adam Reid, Architect
labels: [urgent, dev, review]
---
Discovery $discovery
  Scoping $scope 3d @kev 40% #urgent !!
  Interviews 2d @kev, @adam ~8h/16h {Research}
  Decision $decision 0d [depends $scope] !!!
Build [depends $discovery]
  Develop 5d [depends $decision] "Needs the change board" #dev
  Verify 2d @adam:R #review
  Approve 1d @kev:A
  Recurring 1d [repeats weekly]
