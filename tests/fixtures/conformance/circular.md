---
title: Circular Dependencies
---
Definition $definition
  Charter 2d
  *Gate 0d [depends $definition, Charter]
Loop Phase
  Alpha 2d [depends Beta]
  Beta 3d [depends Alpha]
