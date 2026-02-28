import Foundation

/// Bundled plan templates — same as the web app's templates directory.
struct PlanTemplate: Identifiable {
    let id = UUID()
    let name: String
    let description: String
    let category: String
    let icon: String
    let content: String
}

struct PlanTemplates {
    static let all: [PlanTemplate] = [
        softwareDelivery,
        softwareDevelopment,
        websiteRedesign,
        mobileAppLaunch,
        marketingCampaign,
        eventPlanning,
    ]

    static let softwareDelivery = PlanTemplate(
        name: "Software Delivery",
        description: "Full delivery lifecycle with requirements, design, development, testing, and deployment phases.",
        category: "Technology",
        icon: "shippingbox",
        content: """
        ---
        title: Software Delivery Project
        ---

        Requirements & Analysis
          Requirements gathering @analyst 10d 0% "Gather functional and non-functional requirements"
          Technical analysis @lead 5d [depends Requirements gathering] 0%
          Risk assessment @pm 3d [depends Technical analysis] 0%
          Project planning @pm 5d [depends Risk assessment] 0%
          Requirements sign-off @analyst 0d [depends Project planning] 0%

        Design & Architecture
          System architecture @lead 7d [depends Requirements sign-off] 0%
          Database design @dev 5d [depends System architecture] 0%
          API design @dev 5d [depends System architecture] 0%
          UI/UX design @dev 7d [depends System architecture] 0%
          Design review @lead 2d [depends Database design, API design, UI/UX design] 0%

        Development
          Core framework setup @dev 5d [depends Design review] 0%
          Authentication system @dev 7d [depends Core framework setup] 0%
          API endpoints @dev 10d [depends Authentication system] 0%
          Feature development @dev 15d [depends API endpoints] 0%
          Integration layer @dev 8d [depends Feature development] 0%

        Testing & QA
          Unit testing @qa 5d [depends Integration layer] 0%
          Integration testing @qa 7d [depends Unit testing] 0%
          Performance testing @qa 5d [depends Integration testing] 0%
          User acceptance testing @qa 8d [depends Performance testing] 0%
          Bug fixes @dev 10d [depends User acceptance testing] 0%

        Deployment
          Production setup @devops 5d [depends Bug fixes] 0%
          Data migration @devops 3d [depends Production setup] 0%
          Production deployment @devops 2d [depends Data migration] 0%
          Go-live support @pm 5d [depends Production deployment] 0%
          Project closure @pm 1d [depends Go-live support] 0%
        """
    )

    static let softwareDevelopment = PlanTemplate(
        name: "Software Development",
        description: "Agile software development project with sprints, reviews, and retrospectives.",
        category: "Technology",
        icon: "chevron.left.forwardslash.chevron.right",
        content: """
        ---
        title: Software Development Project
        ---

        Sprint Planning
          Backlog refinement @pm 3d 0% "Review and prioritize user stories"
          Sprint planning @team 1d [depends Backlog refinement] 0%
          Environment setup @dev 2d [depends Sprint planning] 0%

        Sprint 1 - Foundation
          User authentication @dev 5d [depends Environment setup] 0%
          Database models @dev 3d [depends Environment setup] 0%
          API scaffolding @dev 4d [depends Database models] 0%
          Sprint 1 review @team 1d [depends User authentication, API scaffolding] 0%

        Sprint 2 - Core Features
          Feature A implementation @dev 5d [depends Sprint 1 review] 0%
          Feature B implementation @dev 5d [depends Sprint 1 review] 0%
          Unit tests @qa 3d [depends Feature A implementation, Feature B implementation] 0%
          Sprint 2 review @team 1d [depends Unit tests] 0%

        Sprint 3 - Polish & Deploy
          Bug fixes @dev 3d [depends Sprint 2 review] 0%
          Performance optimization @dev 2d [depends Sprint 2 review] 0%
          Documentation @dev 2d [depends Bug fixes] 0%
          Deployment @devops 2d [depends Documentation, Performance optimization] 0%
          Release @pm 0d [depends Deployment] 0%
        """
    )

    static let websiteRedesign = PlanTemplate(
        name: "Website Redesign",
        description: "Complete website redesign project from research through launch.",
        category: "Design",
        icon: "globe",
        content: """
        ---
        title: Website Redesign
        ---

        Research & Discovery
          Stakeholder interviews @pm 5d 0%
          User research @ux 5d 0%
          Competitor analysis @ux 3d 0%
          Content audit @content 5d 0%
          Research synthesis @ux 3d [depends Stakeholder interviews, User research, Competitor analysis] 0%

        Design
          Information architecture @ux 5d [depends Research synthesis, Content audit] 0%
          Wireframes @ux 7d [depends Information architecture] 0%
          Visual design @designer 10d [depends Wireframes] 0%
          Prototype @designer 5d [depends Visual design] 0%
          Design review @pm 2d [depends Prototype] 0%

        Development
          Frontend setup @dev 3d [depends Design review] 0%
          Page templates @dev 10d [depends Frontend setup] 0%
          CMS integration @dev 7d [depends Page templates] 0%
          Responsive testing @qa 5d [depends CMS integration] 0%
          Content migration @content 7d [depends CMS integration] 0%

        Launch
          QA testing @qa 5d [depends Responsive testing, Content migration] 0%
          Performance optimization @dev 3d [depends QA testing] 0%
          Launch @devops 1d [depends Performance optimization] 0%
          Post-launch monitoring @devops 5d [depends Launch] 0%
        """
    )

    static let mobileAppLaunch = PlanTemplate(
        name: "Mobile App Launch",
        description: "Plan for launching a mobile application across iOS and Android.",
        category: "Technology",
        icon: "iphone",
        content: """
        ---
        title: Mobile App Launch
        ---

        Planning
          Market research @pm 5d 0%
          Feature specification @pm 5d [depends Market research] 0%
          Technical architecture @lead 3d [depends Feature specification] 0%
          Project kickoff @pm 0d [depends Technical architecture] 0%

        Design & Prototype
          UI design @designer 10d [depends Project kickoff] 0%
          UX flows @designer 5d [depends Project kickoff] 0%
          Interactive prototype @designer 5d [depends UI design, UX flows] 0%
          User testing @ux 5d [depends Interactive prototype] 0%
          Design refinement @designer 3d [depends User testing] 0%

        Development
          iOS development @ios 20d [depends Design refinement] 0%
          Android development @android 20d [depends Design refinement] 0%
          Backend API @backend 15d [depends Design refinement] 0%
          Push notifications @dev 3d [depends Backend API] 0%
          Analytics integration @dev 2d [depends iOS development, Android development] 0%

        Testing & Submission
          QA testing @qa 10d [depends Analytics integration, Push notifications] 0%
          Beta testing @qa 7d [depends QA testing] 0%
          App store submission @pm 3d [depends Beta testing] 0%
          Launch @pm 0d [depends App store submission] 0%
        """
    )

    static let marketingCampaign = PlanTemplate(
        name: "Marketing Campaign",
        description: "End-to-end marketing campaign from strategy through execution and analysis.",
        category: "Marketing",
        icon: "megaphone",
        content: """
        ---
        title: Marketing Campaign
        ---

        Strategy & Planning
          Campaign brief @pm 3d 0%
          Audience research @analyst 5d [depends Campaign brief] 0%
          Channel strategy @pm 3d [depends Audience research] 0%
          Budget allocation @pm 2d [depends Channel strategy] 0%
          Timeline finalization @pm 1d [depends Budget allocation] 0%

        Content Creation
          Key messaging @content 3d [depends Timeline finalization] 0%
          Blog posts @content 5d [depends Key messaging] 0%
          Social media content @content 5d [depends Key messaging] 0%
          Email templates @content 3d [depends Key messaging] 0%
          Video production @content 10d [depends Key messaging] 0%
          Design assets @designer 7d [depends Key messaging] 0%

        Campaign Execution
          Landing page @dev 5d [depends Design assets, Key messaging] 0%
          Email campaign setup @marketing 3d [depends Email templates, Landing page] 0%
          Social media scheduling @marketing 2d [depends Social media content] 0%
          Ad campaigns @marketing 3d [depends Design assets, Landing page] 0%
          Campaign launch @pm 0d [depends Email campaign setup, Social media scheduling, Ad campaigns] 0%

        Analysis & Reporting
          Performance monitoring @analyst 10d [depends Campaign launch] 0%
          Mid-campaign optimization @marketing 5d [depends Performance monitoring] 0%
          Final report @analyst 3d [depends Mid-campaign optimization] 0%
          Retrospective @pm 1d [depends Final report] 0%
        """
    )

    static let eventPlanning = PlanTemplate(
        name: "Event Planning",
        description: "Conference or large event planning from concept to post-event wrap-up.",
        category: "Operations",
        icon: "calendar.badge.clock",
        content: """
        ---
        title: Event Planning
        ---

        Concept & Budgeting
          Define event goals @pm 2d 0%
          Budget planning @pm 3d [depends Define event goals] 0%
          Venue research @logistics 5d [depends Budget planning] 0%
          Venue booking @logistics 2d [depends Venue research] 0%
          Date confirmation @pm 0d [depends Venue booking] 0%

        Organization
          Speaker outreach @pm 10d [depends Date confirmation] 0%
          Sponsor outreach @pm 10d [depends Date confirmation] 0%
          Catering selection @logistics 5d [depends Venue booking] 0%
          AV setup planning @logistics 3d [depends Venue booking] 0%
          Registration system @dev 5d [depends Date confirmation] 0%

        Promotion
          Event branding @designer 5d [depends Date confirmation] 0%
          Website setup @dev 5d [depends Event branding, Registration system] 0%
          Email invitations @marketing 3d [depends Website setup] 0%
          Social media promotion @marketing 10d [depends Event branding] 0%
          PR outreach @marketing 5d [depends Event branding] 0%

        Execution
          Final walkthrough @pm 1d [depends Catering selection, AV setup planning, Speaker outreach] 0%
          Event day @team 1d [depends Final walkthrough] 0%
          Post-event survey @pm 3d [depends Event day] 0%
          Wrap-up report @pm 3d [depends Post-event survey] 0%
        """
    )
}
