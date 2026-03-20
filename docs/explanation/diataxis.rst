About This Documentation
=========================

This documentation is organised following the `Diátaxis <https://diataxis.fr>`_ framework, a principled approach to structuring technical documentation.

Diátaxis identifies four distinct types of documentation, each serving a different user need:

Tutorials
----------

**Learning-oriented.** Tutorials are lessons that guide a complete beginner through their first experience of the software. The goal is to build confidence through doing, not to provide exhaustive detail.

NoodlePlanner tutorials:

- :doc:`../tutorials/getting-started` — first steps from zero to a rendered plan
- :doc:`../tutorials/first-project` — building a realistic project plan

How-to Guides
--------------

**Task-oriented.** How-to guides help a user accomplish a specific goal. They assume some familiarity with the software and focus on the steps needed, not explanation.

NoodlePlanner how-to guides cover tasks like creating a project, exporting, managing the RAID log, and using specific views.

Reference
----------

**Information-oriented.** Reference material is precise, complete, and neutral in tone. It describes the system as it is — syntax, options, columns, formats — without teaching or explaining.

NoodlePlanner reference pages:

- :doc:`../reference/plan-syntax` — every syntax element
- :doc:`../reference/keyboard-shortcuts` — all keyboard shortcuts
- :doc:`../reference/views` — every view and its columns
- :doc:`../reference/export-formats` — export format specifications
- :doc:`../reference/front-matter` — front matter field definitions

Explanation
------------

**Understanding-oriented.** Explanation pages discuss concepts, design decisions, and background context. They answer "why" questions and help users build a mental model of the system.

NoodlePlanner explanation pages:

- :doc:`rag-status` — what RAG status means and how it is derived
- :doc:`scheduling-engine` — how dates and dependencies are calculated

Contributing to the Docs
-------------------------

Documentation lives in the ``docs/`` directory at the project root. It is written in reStructuredText and built with `Sphinx <https://www.sphinx-doc.org>`_.

To build the documentation locally:

.. code-block:: bash

   cd docs
   make html

The built HTML will be in ``docs/_build/html/``.

When adding or changing features, update the relevant documentation page to keep it accurate.
