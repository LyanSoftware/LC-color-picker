# Pure javascript color picker by LCweb

[toc]

Long story short: needing a compact solution to insert a standard colorpicker with gradient support in LCweb WordPress plugins, didn't find anything really satisfactory.
So I decided to build my own solution in **pure javascript** aiming to create the most compact and flexible plugin I could for modern web apps.

![](picker_preview.gif)

### Top features list:

- single ~52KB file, no dependencies, 100% pure javascript
- supports solid color and/on linear gradient and/or radial gradient
- unlimited gradient color steps support
- optional Photoshop-like dual-track gradient editing (color and opacity stops on separate rows)
- optional lossless dual-track data with a public read/write API
- optional 8-digit `#RRGGBBAA` hex notation for solid colors
- optional OKLCH gradient interpolation (resampled by the plugin, or native `in oklch`)
- optional transparency support
- light/dark theme
- adjustable in-field preview
- mobile ready
- multilanguage ready


Tested on all mordern browsers *(don't ask for old IE support please)* - see [Browser support](#browser-support) for the exact floor
For live demos check: https://lcweb.it/lc-color-picker-javascript-plugin



## Browser support

No dependencies, no polyfills. The floor below is derived from the APIs the source actually uses
(no `String.prototype.replaceAll()`, no ES2019+ syntax):

| Browser | Minimum | Bound by |
|---|---|---|
| Chrome / Chromium / Android WebView | 51 | `NodeList.forEach` and DOM collection iteration |
| Firefox | 51 | `const` inside `for...of` (fixed in Firefox 51) |
| Edge (EdgeHTML) | 18 | `HTMLCollection` iteration |
| macOS Safari | 12.1 | native `<input type="color">` |
| iOS / iPadOS Safari | 12.2 | native `<input type="color">` |
| Internet Explorer | not supported | ES2015 syntax and modern DOM APIs |

This is a static analysis of the source, **not a tested matrix**: the repository has no
cross-browser automation, so treat it as the expected floor and confirm on real devices before
committing to it. The native color input is the colour editor itself, not an optional shortcut,
which is why Safari sits higher than the other engines.

The table describes the default behaviour. The opt-in `interpolation : 'oklch-css'` mode emits
CSS `in oklch` syntax, which needs **Chrome 111 / Safari 16.2 / Firefox 128**: on older engines
the declaration is invalid, so the value is kept as-is but nothing renders.



## Installation & Usage

1. include lc_color_picker.min.js

2. initialize plugin targeting one/multiple text fields


```
<script type="text/javascript>
new lc_color_picker('input');
</script>
```



## Seamless Integration Notes

By default, the plugin will wrap targeted fields with an inline-block DIV. However if you are using percentage sizes on inputs, their sizes could be corrupted.
In this case you have two options:

- enable the *copy_input_width* parameter (NB: static width)

- edit your CSS targeting the the plugin's wrap element, applying sizes also to it. The CSS selector is *.lccp-el-wrap*



## Options

Here are listed available options with default values


```
<script type="text/javascript>
new lc_color_picker('input', {

    // (array) containing supported modes (solid | linear-gradient | radial-gradient) 
    modes : ['solid', 'linear-gradient', 'radial-gradient'], 
    
    // (bool) whether to allow colors transparency tune
    transparency : true, 
    
    // (bool) whether to open the picker when field is focused
    open_on_focus : true, 
    
    // (bool) whether to enable dark picker theme
    dark_theme : false, 
    
    // (bool) whether to stretch the trigger in order to cover the whole input field
    no_input_mode : false, 
    
    // (bool) whether solid colors are stored as 8-digit #RRGGBBAA hex (false keeps the rgba() notation)
    solid_hex8 : false,
    
    // (string) gradient interpolation: 'srgb' | 'oklch' | 'oklch-smoothstep' | 'oklch-css'
    interpolation : 'srgb',
    
    // (int) percentage step used to resample gradients in the 'oklch' / 'oklch-smoothstep' modes
    interpolation_step : 5,
    
    // (bool) whether gradients use separate color/opacity stop rows (Photoshop style).
    // Only applies to instances whose "modes" include a gradient mode.
    // When enabled, no_input_mode is forced to true and the preview covers the whole field
    dual_tracks : false,
    
    // (string) defines the wrapper width. "auto" to leave it up to CSS, "inherit" to statically copy input field width, or any other CSS sizing 
    wrap_width : 'auto',
   
    // (object) defining shape and position of the in-field preview
    preview_style : { 
        input_padding   : 35, // extra px padding eventually added to the target input to not cover text
        side            : 'right', // right or left
        width           : 30,
        separator_color : '#ccc', // (string) CSS color applird to preview element as separator
    },
    
    // (array) defining default colors used when trigger field has no value. First parameter for solid color, second for gradient
    fallback_colors : ['#008080', 'linear-gradient(90deg, #fff 0%, #000 100%)'], 

    // (function) triggered every time field value changes. Passes value and target field object as parameters
    on_change : null, // function(new_value, target_field) {},

    // (array) option used to translate script texts
    labels          : [ 
        'click to change color',
        'Solid',
        'Linear Gradient',
        'Radial Gradient',
        'add gradient step',
        'gradient angle',
        'gradient shape',
        'color',
        'opacity',
        'stop position',
    ],
});
</script>
```



## Dual-track gradients

This editor is **opt-in**: it is off by default, enable it per instance with `dual_tracks : true`
on a picker whose `modes` include a gradient mode. When enabled, the popup shows a single
gradient preview with two stop rows, like the Photoshop gradient editor:

- the **upper row** holds the opacity stops
- the **lower row** holds the color stops

Each row keeps at least one stop. A row with a single stop means "no gradient on that
dimension", so a color-only gradient (one opacity stop) or an opacity-only gradient (one
color stop) needs no extra mode switch. End stops are not locked, they can be dragged and
deleted as long as one stop per row remains.

- Clicking a stop row adds a stop to that row; the preview bar itself does not add stops.
- Selecting a color stop shows only the color editor; selecting an opacity stop shows only
  the opacity editor; with nothing selected both are hidden. In Solid mode both are visible.
  When the panel is anchored above the field the rows keep their space instead of being
  hidden (disabled at 45% opacity), so selecting a stop never shifts the stops under the
  pointer - see [Stop interaction](#stop-interaction).
- Selecting any stop also reveals a **position** field (0-100%) for precise placement. A
  position already used by another stop on the *same* row is nudged to the nearest free
  integer (the two rows may still share positions). Changing it re-sorts the stops and keeps
  the selection on the same stop. The field mirrors the dragged stop while the pointer moves,
  and it is not shown in single-track mode.
- `transparency : false` keeps the opacity row but drops the alpha channel from the output.
- The field value is always a standard `linear-gradient()` / `radial-gradient()` string, so
  it can be used directly in CSS. The two tracks are merged at every stop position.
- Two stops sharing a position **inside the same row** are kept and printed as a hard edge
  (`#f00 50%, #0f0 50%`). The UI never creates them (clicking or dragging nudges to the nearest
  free integer), but the data API accepts them.

Without `dual_tracks` the original single-track editor is used, with the same stop
interaction described below.

### Stop interaction

Both editors share the same behaviour: a stop is a drag handle, not a piece of text.

- Pressing a stop selects it, focuses it and hands the editor below to its track, so the
  fields already follow the pointer while the stop is being dragged.
- Releasing the drag anywhere commits the stop. The position field is updated as the pointer
  moves, so a release outside the row - or outside the panel - needs no trailing click to show
  the final value.
- A gesture belongs to the panel based on where it started, not on where the click lands:
  dragging a stop past the panel edges keeps the panel open, while a click that starts
  outside still closes it. Only clicks carrying a pointer press are matched this way -
  keyboard activation and script clicks keep closing the panel from outside.
- A press becomes a drag only after it travels 3px, so clicking a stop never moves it. The
  position follows the pointer **delta** and not its absolute position, which also makes a
  press a couple of pixels off the stop centre harmless.
- A press that turned into a drag cannot delete a stop: the delete button only reacts to a
  click that starts and ends on it without moving.
- A click that closes a drag never adds a stop, even when the pointer is released over a
  stop row.
- The stop rows swallow `mousedown`, so dragging inside them never starts a native text
  selection or a native image drag (the latter used to swallow `mouseup` and leave the stop
  stuck in mid-drag).

### Lossless data API

The two tracks are stored as JSON in the field's `data-lccp-tracks` attribute, tied to the
last generated CSS value. Reopening the picker restores the independent stop positions.
If the field value is edited externally, or after a full page reload, the tracks are
rebuilt from the CSS string and collapse into paired stops.

```
lc_color_picker.get_gradient_data(field)      // -> object | null
lc_color_picker.set_gradient_data(field, data) // -> bool
```

`field` can be a DOM element or a selector string. `data` looks like this:

```
{
    deg: 90,                 // angle used by linear gradients
    radial_circle: false,    // radial gradient shape (false = ellipse)
    color_steps: [
        {color: '#ff0000', position: 0},
        {color: '#0000ff', position: 100}
    ],
    opacity_steps: [
        {opacity: 1, position: 0},
        {opacity: 0, position: 100}
    ]
}
```

`position` is a percentage (0-100) and `opacity` ranges from 0 to 1. Both arrays are
normalized (sorted, clamped, at least one entry). `set_gradient_data()` updates the field
value, its in-field preview and, when the panel is open on that field, the panel itself
(rebuilt in place, so the selected stop is reset).

`set_gradient_data(field, data, opts)` accepts an optional `opts` object
(`{transparency, interpolation, interpolation_step}`). Anything omitted is taken from the
options the field was initialised with, so a programmatic write generates the same kind of
value the panel would.



## Gradient interpolation

`interpolation` decides how stops are blended when the plugin has to generate the CSS value:

- `'srgb'` (default) - the field value keeps the stops you placed and the browser interpolates
  them in sRGB. Nothing gets rewritten.
- `'oklch'` - the plugin resamples the gradient in OKLCH and writes the extra stops, so the result
  approximates perceptual blending (red to blue passes through magenta instead of grey). The CSS
  stays a plain `linear-gradient()`, so it renders everywhere.
- `'oklch-smoothstep'` - same, with a `t*t*(3-2*t)` easing inside each segment, which softens the
  transition around every stop. The easing only applies to the colour track: opacity always
  interpolates linearly, so the fade keeps a constant speed.
- `'oklch-css'` - no resampling: the value becomes `linear-gradient(in oklch 90deg, ...)` and the
  browser blends it. Best fidelity, but it needs Chrome 111 / Safari 16.2 / Firefox 128.

Both tracks are sampled independently: colours on the OKLCH curve, opacity linearly, and only then
merged into RGBA stops. Merging first and resampling afterwards would drag the colour curve back
towards sRGB wherever the two rows do not share a position.

`interpolation_step` is the sampling step in percent (default `5`) used by the two resampling
modes: a smaller step is smoother and produces a longer field value. Original stop positions are
always kept, so the gradient never shifts when it is resampled.

Since resampling replaces the stops in the field value, `'oklch'` and `'oklch-smoothstep'` also
store the stops you actually placed in a `data-lccp-stops` attribute (the single-track counterpart
of `data-lccp-tracks`). Reopening the picker restores them; editing the field by hand drops that
data and rebuilds the stops from the CSS string.

The option only affects values the plugin generates: a gradient pasted from elsewhere is left
as typed until a stop is touched.


Copyright &copy; Luca Montanari - [LCweb](https://lcweb.it)
