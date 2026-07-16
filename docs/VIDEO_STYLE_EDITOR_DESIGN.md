# Video Style Editor — Interaction Design

- **Status:** Accepted direction; slice implementation and visual review pending
- **Authority:** [`MVP.md`](./MVP.md) is the product-acceptance contract and wins
  if this interaction guide ever conflicts with it.
- **Scope:** Version 0.1 video-style editing in the existing Studio window.

## Purpose

The editor makes project, lyric, and vocal presentation choices discoverable
while preserving a useful view of the video result. It is a design guide, not a
second product specification or an implementation blueprint.

The two mockups are illustrative. They establish hierarchy, reachability, and
control behavior; production screenshots and the MVP acceptance criteria decide
whether the implemented result works at the supported window sizes.

## Accepted outcome

- **Style** is a labeled action beside the Okay Karaoke Studio identity in the
  application header.
- The inspector has no decorative **Document / Project** row. Its first section
  is **Song details**, including the directly editable Global offset.
- Style editing remains in the same application window. The editor and Live
  Preview share the workspace; neither becomes another application window.
- The fixed 16:9 stage stays visible while visual choices are made.
- A style session has two terminal actions: **Cancel** and **Apply & close**.
- The Lead Vocal card keeps a visibly named Sung-color quick action.
- The timing workspace is called the **Lyric Timing area** everywhere.

![Accepted 1280 by 720 layout](./design/video-style-editor-layout.svg)

## Same-window flow

1. The user activates **Style** in the application header.
2. The workspace presents the style editor beside Live Preview.
3. Selecting a style role makes that role the preview's design target.
4. Draft changes appear on the fixed logical stage without changing the saved
   project.
5. **Apply & close** commits the style once; **Cancel** discards the draft.
6. Leaving style editing returns to the prior editing context, including a
   usable Lyric Timing area and transport.

Global offset, song metadata, and media remain project controls rather than
being absorbed into the style editor. The Style action is unavailable while
tap-sync is armed or a Lyric Timing pointer gesture is active, with concise help
explaining what must finish first. Entry never auto-finalizes, discards, or
silently preserves an incomplete timing gesture.

## Minimum-window composition

At 1280 × 720, every required action remains reachable without horizontal page
scrolling. The app header, focused style controls, Live Preview, and transport
remain identifiable. The inspector is available immediately before and after
Style mode, but it may yield while Style is open to preserve a practical stage.
The stage is contained at 16:9 and never stretched to fill spare card space.

The mockup does not prescribe pane pixel widths. The editor may rebalance its
columns at larger sizes, but it must preserve a practical preview and avoid
hiding Apply, Cancel, warnings, or the active control behind nested scrolling.

## Information architecture

The style surface exposes these destinations. Delivery may stage them in
separate cohesive pull requests, but the navigation language remains stable.

### Background

- **Solid**, **Gradient**, and **Image** are mutually exclusive modes.
- Solid exposes one color; Gradient exposes its MVP color pair.
- Image links one static file and offers Choose, Replace, and Clear.
- Missing or undecodable active images remain explicit and block MP4 export.

### Project lyrics

- Typeface, actual face, enumerated size, Sung color, and Unsung color.
- These values are defaults for the authored vocal unless independently
  overridden.
- Sung means the progressive performed fill, not the Scroll advance mode.

### Title card

- Title eyebrow, title, and artist remain separate semantic roles with
  independent visibility and typography.
- A compact **Title card role** selector keeps the chosen role at its true stage
  position while its controls repeat that role in their accessible names.
- A selected hidden role remains hidden in output. Design Preview alone shows it
  with its authored typography, a target outline, and a separate **Hidden in
  output** status.
- Project title and artist remain semantic content, not editable copies inside
  the style model.

### Stage frame

- Frame brand, clock, and footer remain separate semantic roles with independent
  visibility and typography.
- The Stage frame master switch governs the visible frame and its built-in
  brand, clock, and song-metadata elements.
- Playback time remains content, not an editable copy inside the style model.

### Vocal overrides and sync aid

- Each lyric typeface, face, size, Sung, and Unsung field can inherit or
  override the project lyric value independently.
- Alignment is Left, Center, or Right.
- Preview time controls line eligibility before its first sung word.
- The built-in sync aid exposes enabled, minimum lead, and maximum lead while
  following the timing and first-section-line rules in `MVP.md`.

### Saved Style Templates

- Named application-level templates can be created, loaded, renamed, and
  deleted, and template management persists across application restarts.
- They contain every supported creator-configurable stage, lyric-display,
  vocal-style, sync-aid, and export-default setting. A linked background-image
  selection and path are retained without copying or embedding the image.
- They exclude title, artist, loaded audio and its metadata, lyrics, section
  separators, word timings, global offset, and vocal-track identity.
- **Load template** replaces only included fields in the current style draft.
  The project and its history remain unchanged until **Apply & close**, whose
  resulting merge is the one undoable project edit. Creating, renaming, or
  deleting a template does not dirty the open project.
- A missing linked image remains selected, shows the established Preview
  warning/fallback, and blocks MP4 until resolved. An unavailable font remains
  selected and uses the same named deterministic fallback in Live Preview and
  MP4 as a font loaded directly from the project.

## Project lyric typography

![Project lyric typography interaction](./design/project-lyric-typography.svg)

### Typeface combobox

- Typeface is an editable, keyboard-accessible combobox, not a permanent font
  collection browser.
- The text input uses `role="combobox"`, `aria-autocomplete="list"`,
  `aria-expanded`, `aria-controls`, and an active-option relationship.
- Typing filters choices. Arrow Up/Down moves through results; Home/End reaches
  the bounds; Enter accepts; Escape closes without changing the selection.
- Tab leaves the control normally rather than trapping focus in the results.
- Visible options render in their own typeface. Local faces load incrementally
  for visible rows so opening a large installed catalog remains responsive.
- System UI and System Monospace remain available when local enumeration is
  unavailable or denied.
- Filtering alone never changes the draft selection.

### Face, size, and colors

- Face choices are compact buttons generated from the selected typeface's
  actual enumerated faces.
- Unsupported bold, italic, weight, or slant choices are unavailable; the Studio
  does not synthesize a face that was not enumerated.
- Selecting a typeface does not silently rewrite Face or Size. The existing face
  resolves deterministically until the user chooses another actual face.
- Size is a dropdown containing exactly the canonical supported logical-stage
  sizes. It is not a free-form number field or stepper.
- Sung and Unsung are separate labeled color controls with visible values. Sung
  appears first to match the performed-to-unperformed progression on the stage;
  color is never their only identifying cue.

### Live Preview design mode

Typography controls turn Live Preview into a target-aware design palette. The
same fixed logical 1920 × 1080 stage used by video rendering shows
representative content for the role being edited, uniformly scaled into the
available 16:9 surface.

Project lyric design mode shows a representative lyric line at the selected
typeface, actual face, size, Sung color, and Unsung color. A mixed-progress line
makes both colors visible. That lyric is the complete preview sample: the stage
does not add a typeface-name anchor such as `This is <typeface>`, and there is
no separate oversized font specimen in the control panel.

The design mode communicates scale relative to the real video area. Leaving it
restores ordinary timeline-driven Preview without changing the saved style.

## Font permission and recovery

- Installed-font enumeration begins only after a visible user action.
- Denial or an unavailable API does not clear or replace the requested face.
- A warning names the requested face and the effective deterministic fallback.
- Retry is user initiated. Choosing a replacement is explicit.
- A changed installed catalog does not silently rewrite the persisted Typeface,
  Face, or Size.
- Font files and bytes are never copied into a project, template, or package.
- Live Preview and MP4 use the same requested descriptor, resolution rules, and
  named fallback. A renderer-only approximation is a correctness failure.

## Draft and lifecycle contract

Opening Style snapshots only style fields. Live Preview renders the latest
project content with that draft overlaid, so unrelated metadata or timing edits
cannot be overwritten by Apply.

- **Cancel** discards the style draft and creates no history entry.
- **Apply & close** merges the draft once and creates at most one history entry.
- A semantic no-op creates no dirty state or history entry.
- While a draft is open, Save, Export, New, Open, media or lyric import,
  Undo/Redo, Quit, window close, and every other project/history mutation are
  guarded. Playback-only transport actions may continue. A guarded action must
  let the user apply, discard, or keep editing instead of silently losing or
  invalidating the draft.
- Resolving the draft does not bypass the ordinary unsaved-project guard.
- Apply and Cancel do not alter playhead, playback rate, or volume.

## Accessibility and feedback

- Every compact or icon-bearing action has a visible label or accessible name
  and concise hover help.
- Focus enters at the style heading and returns to the Style action on exit.
- Selected navigation, combobox, face, inheritance, and mode states are exposed
  semantically and are not communicated by color alone.
- Warnings are associated with their controls and announced without stealing
  focus. Blocking validation explains what must change before Apply or Export.
- Reduced-motion preferences apply to Preview transitions and the sync aid.

## Delivery slices

1. **Foundation:** authoritative design, shared style model, installed-font
   identity, trusted enumeration, and shared Preview/MP4 resolution.
2. **Behavior:** application-header entry and project lyric typography first;
   then background, title/frame, vocal/sync-aid, and templates as discrete
   reviewable chunks. Every Behavior slice ships its complete draft, history,
   and lifecycle-conflict policy rather than deferring correctness.
3. **Hardening:** large-catalog responsiveness, keyboard and recovery paths,
   lifecycle stress and edge-case coverage, 1280 × 720 visual checks, and
   macOS/Windows parity.

Each slice preserves a green `main`, records deliberate exclusions, and receives
fresh adversarial review. A prior checkpoint review does not approve this revised
interaction.

Checkpoint code is implementation evidence, not an interface contract. Each
slice starts from current `main` and ports the accepted behavior and invariants.
An inherited interface stays only when it remains coherent for current callers,
ownership boundaries, and failure paths; otherwise the slice adapts or replaces
it without pre-v1 compatibility scaffolding.

## Design acceptance and review status

- [x] The user accepted the application-header entry and compact typography
  direction represented here.
- [x] An adversarial UI/UX reviewer verifies this document and both mockups.
- [ ] The Style action and inspector hierarchy are verified at 1280 × 720.
- [ ] Keyboard-only combobox, face, size, color, Cancel, and Apply flows pass.
- [ ] A large installed catalog remains responsive and font-rendered options are
  legible while loading incrementally.
- [ ] Design mode shows accurate stage-relative scale through one mixed lyric
  line, with no typeface-name anchor or separate specimen.
- [ ] Permission denial and missing-font recovery preserve the request and name
  the shared Preview/MP4 fallback.
- [ ] Each Behavior slice includes production before/after evidence on the
  protected macOS and Windows jobs before merge.
