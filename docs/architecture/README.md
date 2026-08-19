# Nexy architecture document set

This folder explains Nexy at two levels:

1. [Nexy functionality guide](NEXY_FUNCTIONALITY_GUIDE.md) explains the product in simple language and then maps each feature to the software that implements it.
2. [SWAD — Software Architecture Design](SWAD-NEXY-SOFTWARE-ARCHITECTURE-DESIGN.md) records the system-wide architecture, boundaries, interfaces, runtime behavior, and security model.
3. [SWDD — Core runtime detailed design](SWDD-NEXY-CORE-RUNTIME.md) explains how one chat turn becomes a streamed, persisted, tool-using conversation.
4. [SWDD — Android companion and synchronization](SWDD-NEXY-ANDROID-COMPANION-AND-SYNC.md) explains pairing, standalone operation, synchronization, conflicts, and credential isolation.
5. [SWDD — Artifacts, workflows, scheduling, Git, and builds](SWDD-NEXY-AUTOMATION-ARTIFACTS-AND-GIT.md) explains Nexy's durable work-product and automation features.
6. [Skills and runtime capabilities](SKILLS_AND_RUNTIME_CAPABILITIES.md) explains skill discovery, activation, MCP capability assignment, and the ThingsBoard audit setup.
7. [Capability activation UX](CAPABILITY_ACTIVATION_UX.md) defines the user-facing flow and the
   conversation-scoped runtime needed to use skills and MCP tools without creating an agent.

These documents describe the implementation baseline represented by Nexy `1.3.37` and the source tree reviewed on `2026-08-19`. The existing [technical architecture reference](../../src/docs/ARCHITECTURE.md) remains the closest source-layout reference; this document set is the explanatory and design-record layer around it.

## How to read the set

Start with the functionality guide if you want to explain Nexy to another person. Use the SWAD when discussing the whole system. Use a SWDD when implementing, reviewing, testing, or changing one subsystem.

The word “server” in these documents usually means a local process or an external service. Nexy does not require a Nexy-hosted account or backend. The desktop owns its local database and can call a provider using the user's key, run an installed CLI, or connect to a local MCP server.
