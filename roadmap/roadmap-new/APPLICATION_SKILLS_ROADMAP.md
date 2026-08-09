# Roadmap: Application Skills and Career-Document Presets

**Status:** Proposed. The reusable import definitions in [`docs/agents/`](../../docs/agents/) are
available now; this roadmap covers product-level preset discovery, guided setup, and workflow
integration that have not been implemented as an app feature.

## Goal

Create preset skills and agents that make it easy to:

- Fill web forms automatically with user-provided data.
- Tailor cover letters and job application text from a base profile.
- Combine browser automation, project wiki, knowledge files, and agent presets without storing private user data inside reusable skills.

## Design Principles

1. Keep skills reusable.
   Skills should define workflow, safety rules, and output expectations. They should not contain the user's private profile data.

2. Store private data separately.
   User-specific information belongs in project wiki entries, agent knowledge files, or explicitly attached documents.

3. Use MCP for browser control.
   The browser/form MCP server should provide page inspection, field interaction, screenshots, and form-filling actions.

4. Require explicit submit approval.
   Agents may fill and review forms, but must not submit job, legal, medical, payment, government, account, or identity forms without direct user approval.

5. Start with importable agent presets.
   Nexy supports custom agents, knowledge files, MCP assignment, tool approval, and reusable skills.
   The three JSON definitions in `docs/agents/` are manually importable examples; they are not yet a
   discoverable in-app preset catalog.

## Proposed Skills

### 1. Form Filler

Purpose: Inspect a web form, map available user data to fields, fill it, and stop before submission.

Workflow:

1. Inspect the current page and identify forms, fields, labels, required fields, validation hints, and submit actions.
2. Map supplied user data to matching fields.
3. Identify missing required data and ask the user before continuing.
4. Fill fields through the MCP browser tools.
5. Review the filled page using the MCP server snapshot or screenshot tools.
6. Summarize what was filled, what was left blank, and what requires user review.
7. Ask for explicit approval before clicking submit or continuing past a final confirmation screen.

Safety rules:

- Never invent identity, legal, financial, employment, education, certification, or authorization details.
- Never submit without explicit user approval.
- Never bypass captchas, security checks, consent gates, or anti-automation controls.
- If a field is ambiguous, ask the user instead of guessing.

Reusable resources:

- Reference: common field mapping patterns.
- Reference: sensitive-field policy.
- Optional schema: normalized personal profile JSON shape.

### 2. Personal Data Profile

Purpose: Normalize reusable user data into a structured profile that other skills can consume.

This is not a place to store preset private data. It defines the expected shape of private data when the user provides it.

Suggested profile sections:

- Identity: name, email, phone, address, links.
- Work authorization: countries, visa/sponsorship status, relocation preference.
- Employment history: company, title, dates, responsibilities, achievements.
- Education: institution, degree, dates, honors.
- Skills: technical skills, languages, tools, certifications.
- Job preferences: roles, seniority, salary expectations, location, remote/hybrid preference.
- Reusable application answers: notice period, availability, portfolio links, default equal-opportunity answers if the user chooses to store them.

Workflow:

1. Ingest a resume, profile text, or user-provided notes.
2. Extract structured fields without inventing missing data.
3. Flag missing or uncertain fields.
4. Save the result as a knowledge file or project wiki entry after user approval.

Reusable resources:

- Reference: profile schema.
- Reference: extraction rules.
- Optional template: empty profile markdown or JSON file.

### 3. Cover Letter Tailor

Purpose: Adapt a base cover letter to a specific job posting.

Inputs:

- Base cover letter.
- Job posting or job URL.
- Resume/profile data.
- Optional tone preference.

Workflow:

1. Extract company, role, location, seniority, responsibilities, and key requirements from the job posting.
2. Identify the strongest matching experiences from the user's resume/profile.
3. Rewrite the cover letter while preserving truthful claims.
4. Keep the output concise and specific to the company and role.
5. Provide a short change summary explaining what was tailored.
6. Flag any missing information that would make the letter stronger.

Safety rules:

- Do not fabricate work history, metrics, education, certifications, location, or authorization.
- Do not claim direct experience unless it is present in the supplied profile.
- Avoid generic filler when specific evidence is available.

Reusable resources:

- Asset: base cover letter template placeholder.
- Reference: tailoring checklist.
- Reference: tone presets.

### 4. Job Application Assistant

Purpose: Coordinate job posting analysis, tailored application text, and browser form filling.

Workflow:

1. Read the job posting from pasted text, a URL, screenshot, or browser page.
2. Extract job facts and required application materials.
3. Tailor the cover letter and short-form answers.
4. Use the Form Filler workflow to populate the application form.
5. Run Application QA before submission.
6. Stop and ask the user before submitting.

Reusable resources:

- Reference: job application workflow.
- Reference: common ATS field mappings.
- Reference: final review checklist.

### 5. Application QA Reviewer

Purpose: Review completed forms and generated application materials before submission.

Checks:

1. Required fields are filled.
2. Company name, role title, and location are consistent.
3. Dates, titles, and education details match the profile.
4. No placeholders remain.
5. No unsupported claims were introduced.
6. No unrelated private information was inserted.
7. The final submit action is clearly identified and still requires approval.

Reusable resources:

- Reference: QA checklist.
- Optional script: compare generated text against profile facts for unsupported claims.

## Proposed Agent Presets

### Application Autofill Agent

Backend:

- BYOK provider with MCP loop today.
- Codex CLI or Claude CLI after CLI MCP bridging is implemented.

Recommended settings:

- Assign browser/form MCP server.
- Enable agentic mode.
- Keep approval required for submit/click-sensitive tools.

Default prompt:

```text
You fill web forms using provided data. Inspect the page first, map data to fields, ask for missing required information, fill fields carefully, and stop before submission. Never invent personal, legal, financial, employment, education, or authorization details. Never submit a form without explicit user approval.
```

### Career Documents Agent

Backend:

- Any text-capable backend.
- MCP not required by default.

Recommended knowledge:

- Resume.
- Base cover letter.
- Personal profile.
- Preferred tone and application rules.

Default prompt:

```text
You tailor career documents truthfully and concisely. Use the provided resume, profile, base cover letter, and job posting. Preserve factual accuracy over persuasion. Flag missing or uncertain information instead of inventing it.
```

### Job Application Agent

Backend:

- BYOK provider with MCP loop today.
- Codex CLI or Claude CLI after CLI MCP bridging is implemented.

Recommended settings:

- Assign browser/form MCP server.
- Attach resume/profile/cover-letter knowledge files.
- Enable agentic mode.
- Require explicit submit approval.

Default prompt:

```text
You help complete job applications end to end. Analyze the job posting, tailor truthful application text, fill forms using browser tools, review the completed application, and stop before final submission until the user explicitly approves.
```

## Implementation Plan

### Step 1: Define Preset Data Model

Add a lightweight preset definition for agents and skills.

Minimum fields:

- `id`
- `name`
- `description`
- `defaultPrompt`
- `recommendedBackend`
- `recommendedMcpServers`
- `recommendedKnowledgeFiles`
- `agenticMode`
- `approvalNotes`

Acceptance criteria:

- Presets can be listed in the UI.
- A preset can create a normal editable Nexy agent.
- Created agents remain ordinary agents after creation.

### Step 2: Add Preset Agent Templates

Create presets for:

- Application Autofill Agent
- Career Documents Agent
- Job Application Agent

Acceptance criteria:

- User can create each preset agent from the agent UI or onboarding/setup flow.
- The created agent has the expected prompt, backend recommendation, and MCP assignment hints.
- If the browser/form MCP server is not configured, the UI clearly prompts the user to add it.

### Step 3: Add Skill Reference Files

Create internal skill reference content for:

- Form Filler
- Personal Data Profile
- Cover Letter Tailor
- Job Application Assistant
- Application QA Reviewer

Acceptance criteria:

- References are concise and reusable.
- Private user data is not included.
- Agents can inject or reference these instructions when the matching preset is used.

### Step 4: Add Personal Profile Setup

Create a guided flow for the user to provide reusable application data.

Options:

- Paste profile text.
- Attach a resume.
- Create an empty profile template.
- Import an existing knowledge file.

Acceptance criteria:

- The app extracts or stores user-approved profile data.
- Missing fields are clearly flagged.
- The saved data is editable.
- The data can be attached to application-focused agents.

### Step 5: Connect Browser/Form MCP Server

Make the browser/form MCP preset easy to add and assign.

Acceptance criteria:

- The user can add the form-capable MCP server from a preset.
- The agent setup screen shows whether the server is installed, enabled, and assigned.
- Tool approval defaults protect submit/final-action tools.

### Step 6: Create Application Workflow Commands

Add slash commands or quick actions:

- `/fill-form`
- `/tailor-cover-letter`
- `/review-application`
- `/apply-to-job`

Acceptance criteria:

- Commands expand into structured task prompts.
- Commands mention required inputs when missing.
- Commands work with the relevant preset agents.

### Step 7: Add Final Review Gate

Before form submission, force a review step.

Acceptance criteria:

- The agent summarizes filled fields and unknowns.
- The agent identifies the submit action.
- The app requires explicit user approval before submit.
- Approval is logged as part of the tool-call history.

### Step 8: Add Tests

Suggested coverage:

- Preset agent creation.
- MCP preset assignment hints.
- Form-filling prompt includes submit safety rule.
- Cover-letter prompt forbids fabrication.
- Application QA checklist is injected for review commands.
- Profile setup does not save extracted data without user approval.

## First Product Milestone Recommendation

Build the smallest useful version first:

1. Surface the three existing importable agent definitions in an in-app preset catalog.
2. Add the Form Filler and Cover Letter Tailor instruction references.
3. Add a profile knowledge-file template.
4. Add `/fill-form` and `/tailor-cover-letter`.
5. Keep final submit approval mandatory.

This gives users immediate value without introducing a full plugin or formal skill runtime.

## Later Enhancements

- Formal skill folder support with `SKILL.md` files.
- Skill marketplace or preset browser.
- Profile schema editor with validation.
- Unsupported-claim detector for generated career documents.
- Application history tracker.
- Job posting parser that stores company, role, URL, status, and generated materials.
- CLI MCP bridge so Codex CLI and Claude CLI can use Nexy-configured MCP servers directly.
