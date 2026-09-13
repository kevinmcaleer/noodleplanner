#!/bin/sh
# NoodlePlanner: delete 92 remote branches whose PR was merged (or that are
# fully contained in main). No unmerged commits are lost.
# Open PRs (#1176 #1175 #1174 #1148 #948 #862) and main are excluded.
# Verified against origin on 2026-09-13.
set -e
git fetch origin --prune

git push origin --delete chore/pymppwriter-from-pypi
git push origin --delete claude/awesome-pasteur-95yh2o
git push origin --delete claude/complete-1046-1b082z
git push origin --delete claude/complete-goal-780-x5t2v8
git push origin --delete claude/complete-goal-974-ps4znz
git push origin --delete claude/complete-goal-998-ip194w
git push origin --delete claude/goal-1049-46oaav
git push origin --delete claude/goal-1057-ea3509
git push origin --delete claude/goal-1068-abygzt
git push origin --delete claude/goal-783-fd4nbt
git push origin --delete claude/goal-903-15ilbi
git push origin --delete claude/goal-956-at0u2r
git push origin --delete claude/goals-984-985-986-908-drkjw8
git push origin --delete claude/happy-bohr-daufd7
git push origin --delete claude/issue-1055-miekhb
git push origin --delete claude/issue-1061-xybjwa
git push origin --delete claude/issue-1063-ofugm5
git push origin --delete claude/issue-1065-ver0iu
git push origin --delete claude/issue-788-status-54bpa7
git push origin --delete claude/portfolio-powerpoint-export-zpho3h
git push origin --delete claude/task-777-naming-ql3lek
git push origin --delete codex/1070-drag-create-column
git push origin --delete codex/1082-preserve-editor-cursor
git push origin --delete codex/906-kanban-model-reorder
git push origin --delete codex/issue-785
git push origin --delete codex/issue-905
git push origin --delete codex/noodleplanner-dbml-model
git push origin --delete copilot/add-in-browser-excel-export-import
git push origin --delete copilot/create-linked-sub-issues
git push origin --delete copilot/epic-whiteboard-enhancements
git push origin --delete copilot/natural-language-date-capture
git push origin --delete copilot/review-noodleplanner-ui-ux
git push origin --delete docs/claude-md-worktree-per-goal
git push origin --delete docs/cloudflare-tunnel-credentials
git push origin --delete docs/deliverables-feature
git push origin --delete docs/update-product-and-comms-docs
git push origin --delete feat/1036-backmatter-sections
git push origin --delete feat/1090-ui-improvements
git push origin --delete feat/598-lessons-learned
git push origin --delete feat/712-search-facility
git push origin --delete feat/717-version-rollover
git push origin --delete feat/724-excel-summary-percent-complete
git push origin --delete feat/745-native-mpp-export
git push origin --delete feat/761-sync-file-linking
git push origin --delete feat/770-mpp-in-browser
git push origin --delete feat/771-markdown-canonical
git push origin --delete feat/790-vendor-and-default
git push origin --delete feat/791-browser-pptx
git push origin --delete feat/792-browser-pdf-docx
git push origin --delete feat/793-browser-scheduler
git push origin --delete feat/793-default-on
git push origin --delete feat/794-browser-local-store
git push origin --delete feat/809-pwa
git push origin --delete feat/811-window-drop-import
git push origin --delete feat/971-load-test-security-signoff
git push origin --delete feat/browser-mpp-export
git push origin --delete feat/mpp-replaces-xml-menu
git push origin --delete feature/595-dark-mode
git push origin --delete fix/1169-backmatter-editor
git push origin --delete fix/649-templates-modal
git push origin --delete fix/721-commented-table-rows
git push origin --delete fix/723-placeholder-leak
git push origin --delete fix/753-mspdi-schema-valid-export
git push origin --delete fix/757-workload-heatmap-full-range
git push origin --delete fix/808-depends-colon
git push origin --delete fix/808-followup-test
git push origin --delete fix/benefits-markdown-parsed-as-tasks
git push origin --delete fix/benefits-view-blank-on-open
git push origin --delete fix/forecast-respect-green-rag
git push origin --delete fix/ipad-tools-build-version
git push origin --delete fix/minimal-timeline-hierarchy-and-row-cap
git push origin --delete fix/minimal-timeline-sub-summary-parent-rows
git push origin --delete fix/stalled-status-uses-last-saved
git push origin --delete fix/whiteboard-toolbar-tab-order
git push origin --delete issue-516-aria-semantic-html
git push origin --delete issue-627-quality-analyser
git push origin --delete issue-628-comms-plan
git push origin --delete issue-629-reoccurring-tasks
git push origin --delete issue-630-programme-dependencies
git push origin --delete issue-632-user-docs
git push origin --delete issue-653-timeline-milestone-clipping
git push origin --delete issue-655-milestone-table-columns
git push origin --delete issue-659-risks-table-columns
git push origin --delete issue-660-gantt-toolbar-layout
git push origin --delete issue-663-task-form-first-click
git push origin --delete issue-667-rename-dependencies
git push origin --delete issue-672-quality-management
git push origin --delete issue-681-resource-levelling
git push origin --delete perf/789-parse-once
git push origin --delete perf/parse-benchmark-harness
git push origin --delete remove-database
git push origin --delete test/956-wire-kanban-mutations-test

git fetch origin --prune
echo "Done. Remaining remote branches: $(git ls-remote --heads origin | wc -l)"
