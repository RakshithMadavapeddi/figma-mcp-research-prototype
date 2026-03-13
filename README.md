# Rapid Prototyping with Figma MCP and AI-Assisted Code Generation

This repository contains a research prototype demonstrating a workflow
for converting Figma design frames into interactive usability-testing
prototypes using **Figma's MCP Server** and **AI-assisted code
generation**.

The goal is not production UI development, but **rapid creation of
realistic prototypes** that can be used in moderated usability testing
sessions.

------------------------------------------------------------------------

## Case Study

Full breakdown of the workflow and methodology:

https://rakshith.design/figma-mcp-ai-prototyping

The case study explains:

• How MCP provides structured design context to LLMs\
• Converting Figma frames into static HTML screens\
• Building interaction logic using AI-assisted code generation\
• Creating deterministic states for usability testing\
• Implementing scenario control and edge-case flows

------------------------------------------------------------------------

## Purpose of this Prototype

Traditional Figma prototypes often struggle to simulate complex mobile
interactions such as:

-   Device hardware integrations
-   Scanner-based autofill
-   Payment flows
-   Dynamic state changes
-   Error states and edge cases

This prototype demonstrates an alternative approach where:

**Figma designs → MCP context → AI-generated UI → Interactive testing
prototype**

The result is a lightweight browser-based prototype that can simulate
realistic product behavior during usability studies.

------------------------------------------------------------------------

## Prototype Scenario

The prototype simulates a **mobile check-in workflow** for a hospitality
application designed to run on **portable POS devices with built-in
barcode scanners and card readers**.

Key interactions demonstrated:

• Scan-to-autofill guest registration\
• Tap-to-pay payment flow\
• Validation and error handling\
• Deterministic states for usability scenarios

These features were implemented to support **usability testing with
non-technical primary users**.

------------------------------------------------------------------------

## Workflow Overview

### 1. Design Preparation (Figma)

Frames are structured using:

-   Auto Layout
-   A lightweight design system
-   Figma Dev Mode annotations

These provide structured design context for AI tools through MCP.

------------------------------------------------------------------------

### 2. Frame-by-Frame UI Generation

Each Figma frame is converted into a **static HTML screen** by providing
the frame link (with node ID) to an AI code generation tool.

Using MCP context, the model extracts:

-   Frame screenshot
-   Layout structure
-   Component hierarchy
-   Variables and tokens
-   Dimensions and spacing

This enables near **pixel-accurate UI reproduction**.

------------------------------------------------------------------------

### 3. Special Interaction Implementation

Screens requiring dynamic logic (e.g. scanning or autofill) are
implemented individually using prompts that include:

-   User story
-   Task flow
-   Required states
-   Edge cases
-   External libraries (if needed)

------------------------------------------------------------------------

### 4. Happy Path Execution

Once all static screens are generated, the intended user journey is
implemented.

The prompt includes:

-   User story
-   Task flow
-   Interaction logic
-   Screen transitions

This establishes the baseline interaction flow.

------------------------------------------------------------------------

### 5. Scenario Control and Edge Cases

Additional prompts are used to implement:

-   Deterministic states
-   Edge-case behaviors
-   Scenario toggles for testing

This enables researchers to simulate specific conditions during
usability sessions.

------------------------------------------------------------------------

## Tech Stack

Lightweight web stack used for maximum portability:

HTML\
CSS\
JavaScript

The prototype is designed to run on any modern mobile browser.

------------------------------------------------------------------------

## Running the Prototype

You can run the prototype locally by opening:

index.html

in a browser.

For usability testing, the prototype can also be deployed via **GitHub
Pages**.

------------------------------------------------------------------------

## Research Use

This approach is useful for:

• Usability testing\
• Interaction validation\
• Feature concept validation\
• Early product research

It allows researchers and designers to create **high-fidelity
interactive prototypes without full engineering implementation**.

------------------------------------------------------------------------

## Author

Rakshith Reddy\
UX Researcher & Designer

Portfolio:\
https://rakshith.design

Case Study:\
https://rakshith.design/figma-mcp-ai-prototyping
