---
title: Software Deployment
project manager: Release Manager
Resources:
- @rm: Release Manager, Release Coordination
- @dev: Developers, Development Team
- @ops: Operations Engineers, Infrastructure
- @qa: QA Engineer, Quality Assurance
- @sec: Security Analyst, Security
- @sup: Support Lead, Customer Support
labels: [software, deployment, release, operations]
---

Release Readiness
  Confirm release scope @rm 2days 0% "Agree exactly what is going out and what is not"
  Freeze the release candidate @dev 1day [depends Confirm release scope] 0% "Code freeze and tagged release candidate"
  Release notes @rm 2days [depends Freeze the release candidate] 0% "Customer-facing and internal release notes"
  Security review @sec 3days [depends Freeze the release candidate] 0% "Dependency scan and review of the changes going out"
  Ready for change approval milestone @rm 0days [depends Release notes, Security review] 0% "Release candidate ready to be approved"

Change Approval
  Write the deployment runbook @ops 3days [depends Ready for change approval milestone] 0% "Step-by-step deployment and verification steps"
  Write the rollback plan @dev 2days [depends Ready for change approval milestone] 0% "How to undo the release, and the point after which we cannot"
  Submit change request @rm 1day [depends Write the deployment runbook, Write the rollback plan] 0% "Raise the change with the runbook and rollback plan attached"
  Change advisory board review @rm 2days [depends Submit change request] 0% "Change reviewed and scheduled"
  Change approved milestone @rm 0days [depends Change advisory board review] 0% "Approval to deploy granted"

Staging Rehearsal
  Prepare staging @ops 2days [depends Write the deployment runbook] 0% "Staging matches production configuration"
  Rehearse the deployment @ops 1day [depends Prepare staging] 0% "Run the runbook end to end on staging"
  Smoke and regression tests @qa 3days [depends Rehearse the deployment] 0% "Verify the release on staging"
  Rehearse the rollback @ops 1day [depends Smoke and regression tests, Write the rollback plan] 0% "Prove the rollback works before it is needed"
  Rehearsal passed milestone @qa 0days [depends Rehearse the rollback] 0% "Staging rehearsal complete"

Production Cutover
  Notify customers and support @sup 1day [depends Change approved milestone, Rehearsal passed milestone] 0% "Advance notice of the deployment window"
  Take backups @ops 1day [depends Notify customers and support] 0% "Verified backups of data and configuration"
  Deploy to production @ops 1day [depends Take backups] 0% "Run the runbook"
  Post-deployment verification @qa 1day [depends Deploy to production] 0% "Check the live system against the runbook's verification steps"
  Go / no-go decision @rm 0days [depends Post-deployment verification] 0% "Keep the release or roll it back"
  Release live milestone @rm 0days [depends Go / no-go decision] 0% "New version live in production"

Hypercare
  Monitor errors and performance @ops 5days [depends Release live milestone] 0% "Watch dashboards and alerts closely after release"
  Triage support tickets @sup 5days [depends Release live milestone] 0% "Fast-track anything caused by the release"
  Fix urgent defects @dev 3days [depends Monitor errors and performance] 0% "Hotfix anything that cannot wait"
  Release retrospective @rm 1day [depends Fix urgent defects, Triage support tickets] 0% "What went well, what to change next time"
  Hypercare complete milestone @rm 0days [depends Release retrospective] 0% "Release handed over to business as usual"
