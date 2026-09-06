Use NoodlePlanner on a touch device
===================================

NoodlePlanner supports touch input on phone and tablet browsers. Standard
buttons, menus, forms, and cards use a minimum 44-pixel activation area when a
coarse pointer is detected.

Navigate and edit
-----------------

Tap navigation buttons to open their menus, then tap an item to select it. Tap
outside an open menu to dismiss it.

In tables and diagrams:

* Tap an editable Gantt cell to edit it. The desktop double-click and keyboard
  controls remain available.
* Tap a NoodleSheet cell to select it, then tap it again to edit. Press and hold
  a cell to open its action menu.
* Press and hold a NoodleSheet tab to rename or delete the sheet.
* Tap a selected Mind Map or Benefits Map node again to edit it.

Move and resize items
---------------------

* Drag Gantt bars to move them and drag either edge to resize them.
* Drag Board cards between columns. The ``Move...`` selector on each card is a
  precise alternative when dragging is inconvenient.
* In phase Board view, drag columns or use their left and right arrow buttons.
* Drag NoodleSheet column boundaries to resize them.
* Drag the empty area of a diagram to pan it. Use the toolbar zoom controls or
  pinch where supported.
* In Product Flow, drag from an output connector to a target, or tap the output
  connector and then tap the target product.

Touch release check
-------------------

Before a release that changes these interactions, check the following matrix
on physical devices or the corresponding browser device emulation:

.. list-table::
   :header-rows: 1

   * - Platform
     - Viewport
     - Required checks
   * - iOS Safari
     - Phone
     - Menus dismiss; Board scroll and move; NoodleSheet select/edit; no page zoom on form focus
   * - iOS Safari
     - Tablet
     - Gantt edit/move/resize; diagram pan and zoom; cancelled gestures make no edits
   * - Android Chrome
     - Phone
     - Menus dismiss; Board scroll and move; NoodleSheet long-press menu; no duplicate actions
   * - Android Chrome
     - Tablet
     - Gantt edit/move/resize; diagram pan/connect; mouse and keyboard still work when attached

