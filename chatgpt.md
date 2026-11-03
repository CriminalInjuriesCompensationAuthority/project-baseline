
the other aspect of this to consider is that this needs to cater for retrospectively "fixing up" existing repos, and be a starting point for brand new repos too
That actually strengthens the case for having a single, centrally managed engineering standards system, rather than simply a repository template.

You need to support three distinct scenarios:

New repositories — start with all the correct files, dependencies, versions, workflows and policies.

Existing repositories — bring older projects into line with the current standards without destroying their existing configuration.

Ongoing maintenance — keep both new and existing repositories up to date whenever the central standards change.

Crucially, all three should work from the same source of truth. Otherwise, you risk having one set of standards for new repositories and a different mechanism for maintaining old ones.

The lifecycle I'd aim for
Central engineering standards

Templates, version policies, shared tooling and workflows


New repository

Generate from the latest approved template

Bootstrap

Existing repository

Analyse and adopt standards selectively

Retrofit

Ongoing synchronisation

Central changes → repository PRs → CI → approval

The most important design principle is that a repo created today and a repo adopted from five years ago should ultimately be maintained in exactly the same way.

How to retrospectively fix existing repositories
This is where I'd be more careful about choosing Copier or Projen.

Consider three repositories:

Repository

Current state

Desired outcome

Service A

Node 24, Biome, current CI

Adopt standards with minimal changes

Service B

Node 20, ESLint, old Dockerfile

Upgrade and standardise

Service C

Node 18, custom testing and deployment

Adopt gradually without breaking anything

A naive templating solution would simply overwrite files with the standard versions. That's not what you want.

Instead, I'd build a repository adoption process with four stages:

Inspect: Determine which standards the repository already meets.

Plan: Produce a report of files to create, replace, merge or leave alone.

Apply: Generate changes on a separate Git branch.

Validate: Run CI and raise a pull request showing exactly what's changed.

For example, an adoption report might look like:

Repository: service-b
Profile: node-web-service

✔ README.md exists
✘ Node.js 20 → 24
✘ ESLint → Biome
✔ Node test runner already configured
✘ GitHub Actions CI → reusable workflow
✘ Dockerfile → approved base image
✔ .gitignore complies

Proposed changes: 8 files
Manual review required: 2 files
This would be a custom adoption layer built around your chosen tools, rather than something Copier provides out of the box.

An important Copier limitation: Its normal update mechanism assumes a repository was previously generated from a versioned template and has valid Copier metadata. You can't safely add a .copier-answers.yml to an arbitrary old repository and pretend that it's always been managed by that template. 

copier

For existing repositories, I'd use an explicit initial adoption workflow to establish that baseline correctly, and test it against real examples.

What changes for brand-new repositories?
For new projects, the same template can be used immediately:

copier copy \
  gh:your-org/engineering-standards \
  my-new-service

During creation, it could ask for a few project-specific choices:

New repository setup
Illustrative set of options backed by the central template.
Project type

Node.js / Express web service

Node.js API

Shared npm library
Linting
biome
Testing
node
Deployment profile

Docker / Kubernetes

No deployment configuration
New repositories could also receive the correct GitHub permissions, repository rules and security settings during provisioning.

Longer-term, you could put a web interface in front of this using something like Backstage Software Templates, but I wouldn't introduce Backstage just for this unless your organisation already uses it. 

GitHub

One further improvement: standards profiles
I wouldn't insist that every project uses identical technology.

Instead, define a small number of approved profiles:

engineering-standards/
├── profiles/
│   ├── node-web-service/
│   ├── node-api/
│   ├── node-library/
│   └── legacy-node/
├── common/
└── policies/
A repo could opt into node-api, for example. Your synchronisation tool would know exactly which files and policies applied to it.

This provides a useful migration path: an older repository could initially adopt legacy-node, then move onto node-api as part of an explicitly reviewed upgrade.

Profiles should be as small and composable as practical to avoid maintaining multiple copies of almost identical files.

Revised recommendation
With retrospective adoption now an explicit requirement, I'd structure the solution around these responsibilities:

Responsibility

Proposed solution

Create a repository

Copier template

Adopt an existing repository

Custom audit/adoption workflow + Copier

Synchronise shared files

Copier + GitHub Actions orchestration

Keep dependencies updated

Renovate

Share CI/CD logic

GitHub reusable workflows

Enforce governance

Organisation rulesets + Teams

Report drift

Custom compliance inventory

Renovate's onboarding and inherited configuration options are particularly useful when introducing dependency management to existing repositories at scale. 

Renovate Docs
+1

I'd now make retrospective adoption a mandatory part of evaluating Copier against Projen, rather than treating it as a later enhancement.

The proof of concept should demonstrate one complete cycle: create a new repository, retrospectively adopt an existing repository, then change the central standards and show that both receive equivalent update pull requests.

If that works reliably, you've validated the central concept—and have the foundation of a system that can progressively clean up the entire organisation without a disruptive wholesale migration.

what would be a good name for this shared repo? give me some ideas?
Given that this repository will be responsible for creating new repositories, bringing existing ones up to standard, and keeping everything consistent, I'd choose something broader than shared-config or repo-template.

Here are some ideas, ranging from sensible and descriptive to slightly more creative.

Clear and professional
Name

Why it works

engineering-standards

Broad, professional and immediately understandable

repo-standards

Short, descriptive and focused on repositories

repo-foundation

The common foundation for all repositories

project-blueprints

Defines how projects should be built and maintained

engineering-toolkit

Suggests a collection of shared engineering tools

repo-governance

Emphasises consistency, policies and compliance

project-scaffolding

Good for new projects, less so for ongoing maintenance

More creative / memorable
Name

Concept

repo-forge

Creates, shapes and maintains repositories

repo-keeper

Keeps all repositories in good condition

repo-sync

Emphasises continuous synchronisation

repo-doctor

Diagnoses and fixes outdated repositories

repo-gardener

Keeps a whole organisation's repositories healthy

repo-foundry

A central place where repositories are created and maintained

repo-compass

Guides repositories towards shared standards

repo-blueprint

The master design for repositories

repo-steward

Looks after repositories throughout their lifecycle

repo-hub

Central home for shared repository configuration

Names that suggest a central source of truth
These might be particularly appropriate given your goal of managing configuration across dozens of independent projects.

project-canonical — one authoritative definition of how projects should look.

repo-baseline — establishes and maintains an approved baseline.

engineering-core — central engineering configuration and tooling.

repo-conductor — coordinates updates across multiple repositories.

project-standards — clearly describes the central authority.

repo-control — centralised control over repository configurations.

My top five
1

{item.n}
Best all-round name

My favourite creative option. Suggests both creating new repositories and improving existing ones.

2

{item.n}

The safest professional choice, especially in a large organisation.

3

{item.n}

Highlights ongoing upkeep, governance and repository health.

4

{item.n}

Excellent if compliance, consistency and reducing configuration drift are the main priorities.

5

{item.n}

Short, memorable and quite developer-friendly.

I'm particularly drawn to repo-foundry.

You could give it a nice identity and describe it as:

Repo Foundry — a centralised system for creating, standardising and maintaining repositories across the organisation.

It also lends itself nicely to commands or workflows such as foundry init, foundry adopt, foundry sync and foundry audit, should you eventually create your own wrapper around Copier and the other tools.

One consideration: if the repository will contain only shared definitions and templates, repo-foundry might be slightly grand. But if it's going to become the home of the entire process—including onboarding, retrospective adoption, automation and compliance—I'd say it fits extremely well.

1
{item.n}
Best all-round name


My favourite creative option. Suggests both creating new repositories and improving existing ones.
2
{item.n}
The safest professional choice, especially in a large organisation.
3
{item.n}
Highlights ongoing upkeep, governance and repository health.
4
{item.n}
Excellent if compliance, consistency and reducing configuration drift are the main priorities.
5
{item.n}
Short, memorable and quite developer-friendly.

Sorry! Looks like the formatting broke in my previous response and displayed {item.n} instead of the actual repository names.

Here are my top five properly:

Rank

Repository name

Reason

1

repo-foundry

My favourite. Suggests both creating new repositories and improving existing ones.

2

engineering-standards

The safest professional choice, especially in a large organisation.

3

repo-steward

Highlights ongoing upkeep, governance and repository health.

4

repo-baseline

Excellent for compliance, consistency and reducing configuration drift.

5

repo-forge

Short, memorable and developer-friendly.

I'd still go with repo-foundry.

It captures all three purposes nicely: create, modernise and maintain repositories.

And you could eventually have commands like:

foundry init     # Create a new repository
foundry adopt    # Bring an existing repository into the system
foundry sync     # Update to the latest standards
foundry audit    # Check for configuration drift

how about something like "project-baseline" or something
I actually really like project-baseline. I think it might be a better fit than repo-foundry, particularly in a professional engineering environment.

The word baseline communicates exactly what you're trying to achieve: establishing a consistent starting point, bringing existing projects up to standard, and maintaining that standard over time.

A few variations worth considering:

Name

Thoughts

project-baseline

Excellent all-rounder. Clear, professional and broad enough for your objectives.

repo-baseline

Similar, but more explicitly focused on GitHub repositories.

engineering-baseline

Suggests organisation-wide engineering standards, not just repository files.

project-foundation

Emphasises a common starting point for every project.

project-standards

Very clear, although sounds more like documentation than tooling.

project-blueprint

Great for generating new repositories, but less suggestive of ongoing maintenance.

project-core

Short and simple, although a little vague.

baseline

Minimalist and memorable, but potentially ambiguous.

project-conventions

Good for shared practices, linting and configuration.

engineering-foundation

Broader and more architectural.

My preference
I'd narrow it down to three:

project-baseline — best balance of clarity and purpose.

engineering-baseline — best if this grows into organisation-wide engineering governance.

repo-baseline — best if you want the focus firmly on GitHub repositories.

And I'd describe the project like this:

Project Baseline — A centralised framework for creating new repositories, bringing existing projects into alignment, and maintaining consistent engineering standards, dependencies and configuration across the organisation.

You could also have a really intuitive set of commands:

baseline init      # Create a new project
baseline adopt     # Apply standards to an existing project
baseline update    # Synchronise with latest standards
baseline check     # Check compliance and configuration drift

One distinction worth considering: a baseline traditionally describes a minimum accepted standard, rather than necessarily enforcing identical configurations everywhere.

For your situation, that's actually a strength. It allows individual repositories to have legitimate differences while still meeting a common organisational standard.

I'd put project-baseline at the top of the list.

application-baseline?
application-baseline is a strong contender. In fact, I think it might be the most appropriate name so far, depending on the scope.

It sounds professional, purposeful, and describes a shared standard that applications should adhere to.

Here's how I'd compare the three:

Name

What it communicates

repo-baseline

Standards for GitHub repositories, including files, permissions and workflows

project-baseline

A common foundation for software projects, including tooling and configuration

application-baseline

A consistent technical foundation for applications throughout their lifecycle

Why I like application-baseline
It fits your requirements particularly well:

New applications: Generate a repository with the approved dependencies, configuration and tooling.

Existing applications: Retrospectively bring them into alignment with the baseline.

Ongoing maintenance: Keep applications aligned as standards evolve.

Flexibility: Different types of applications can have different configurations while sharing common standards.

One consideration
The word application potentially excludes repositories that aren't applications, such as shared npm libraries, reusable GitHub Actions, infrastructure-as-code or documentation repositories.

If those are also within scope, project-baseline is slightly more inclusive.

My preference
Given what you've described, I'd rank them:

application-baseline — if you're primarily standardising deployable applications and services.

project-baseline — if you want to cover every type of software project.

repo-baseline — if the emphasis is on GitHub repository configuration and governance.

A suitable GitHub description would be:

A centrally managed baseline for creating, modernising and maintaining applications with consistent dependencies, tooling, configuration and engineering standards.

I particularly like the three verbs create, modernise, maintain. They capture the entire purpose of what you're building.

My only question is whether you're intending to cover all GitHub repositories in the organisation, including libraries and infrastructure repositories, or primarily the Node.js applications and services. That would determine whether I'd choose project-baseline or application-baseline.




