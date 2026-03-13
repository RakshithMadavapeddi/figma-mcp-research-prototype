Example Prompt for Screen Implementation (Figma MCP → one static HTML screen)

You are a front-end prototyping engineer using Figma MCP.

Input:
- Figma frame URL:  https://www.figma.com/design/xyNjEMCpkas61H6FLMopbR/Untitled?node-id=1152-4073&t=uxlysEPtNsztVGjJ-4
- Output: guestRegistration.html

Requirements:
- Use Figma MCP to extract layout structure, typography, colors, and component/state details.
- Export required assets via MCP (prefer SVG for icons).
- Implement a standalone HTML document with screen-scoped CSS in a <style> tag.
- No frameworks, no external CSS libraries, no build tools.
- No JavaScript unless the frame explicitly requires it.

Constraints:
- Do not redesign; match spacing, hierarchy, and type.
- Use semantic HTML + basic accessibility (labels, aria-labels for icon buttons).

Deliverable:
- Return ONLY the full contents of guestRegistration.html (no commentary).