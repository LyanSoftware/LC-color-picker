/**
 * lc_color_picker.js - The colorpicker for modern web
 * Version: 2.1.1
 * Author: Luca Montanari (LCweb)
 * Website: https://lcweb.it
 * Licensed under the MIT license
 */


(function() { 
	"use strict";
    if(typeof(window.lc_color_picker) != 'undefined') {return false;} // prevent multiple script inits  
    
    
    /*** vars ***/
    let window_width   = null,
    
        style_generated = null,
        active_trigger  = null,
        active_trig_id  = null,
        
        active_solid    = null,
        active_opacity  = null,
        active_gradient = null,
        active_mode     = 'solid',
        
        sel_grad_step   = 0, // selected gradient step
        sel_track       = null, // selected track in dual mode ('color' | 'opacity' | null)
        dual_active     = false, // whether the currently open picker uses dual tracks
        drag_state      = null, // {onMove, onEnd} of the gradient stop currently being dragged
        drag_moved      = false, // whether the current press on a stop moved past the deadzone
        
        gradient_data   = {
            deg: 0,
            radial_circle: false,
            steps: [
                //{color : null, opacity: null, position : null}
            ],
            color_steps: [
                //{color : null, position : null}
            ],
            opacity_steps: [
                //{opacity : null, position : null}
            ],
        };
    
    
    // per-field instance registration: the static API mirrors these options and redraws an open panel
    const field_instances = new WeakMap();
    
    
    /*** default options ***/
    const def_opts = {
        modes           : ['solid', 'linear-gradient', 'radial-gradient'], // (array) containing supported modes (solid | linear-gradient | radial-gradient) 
        open_on_focus   : true, // (bool) whether to open the picker when field is focused
        transparency    : true, // (bool) whether to allow colors transparency tune
        dark_theme      : false, // (bool) whether to enable dark picker theme
        no_input_mode   : false, // (bool) whether to stretch the trigger in order to cover the whole input field
        solid_hex8      : false, // (bool) whether solid colors are stored as 8-digit #RRGGBBAA hex (false keeps the rgba() notation)
        interpolation   : 'srgb', // (string) gradient interpolation: 'srgb' | 'oklch' | 'oklch-smoothstep' | 'oklch-css'
        interpolation_step : 5, // (int) percentage step used to resample gradients in the plug-in interpolation modes
        dual_tracks     : false, // (bool) whether gradients use separated color/opacity stop tracks. Only applies to instances supporting gradient modes
        wrap_width      : 'auto', // (string) defines the wrapper width. "auto" to leave it up to CSS, "inherit" to statically copy input field width, or any other CSS sizing 
        preview_style   : { // (object) defining shape and position of the in-field preview
            input_padding   : 35, // extra px padding eventually added to the target input to not cover text
            side            : 'right', // right or left
            width           : 30,
            separator_color : '#ccc', // (string) CSS color applird to preview element as separator
        },
        fallback_colors : ['#008080', 'linear-gradient(90deg, #fff 0%, #000 100%)'], // (array) defining default colors used when trigger field has no value. First parameter for solid color, second for gradient
        
        on_change       : null, // function(new_value, target_field) {}, - triggered every time field value changes. Passes value and target field object as parameters
        
        labels          : [ // (array) option used to translate script texts
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
    };
    
    
    // shortcut var to target the text input only
    const right_input_selector = 'input:not([type="color"])';
    
    // px a press on a gradient stop has to travel before it is treated as a drag
    const drag_deadzone = 3;
    
    
    
    // input value check custom event
    const lccp_ivc_event = function(picker_id, hide_picker = false) {
        return new CustomEvent('lccp_input_val_check', {
            bubbles : true,
            detail: {
                picker_id   : picker_id,
                hide_picker : hide_picker   
            }
        });
    };

    
    
    /*** hide picker cicking outside ***/
    document.addEventListener('click', function(e) {
        const picker = document.querySelector("#lc-color-picker.lccp-shown");
        if(!picker || e.target.classList.contains('lccp-preview')) {
            return true;    
        }
        
        // is an element within a trigger?
        for (const trigger of document.getElementsByClassName('lccp-preview')) {
            if(trigger.contains(e.target)) {
                return true; 
            }    
        }
        
        // clicked on the same colorpicker field? keep visible
        if(e.target.parentNode && e.target.parentNode.classList && e.target.parentNode.classList.contains('lccp-el-wrap') && document.getElementById(active_trig_id)) {
            return true;    
        }

        // close if clicked element is not in the picker
        if(!picker.contains(e.target) && !e.target.classList.contains('lccp-shown')) {
            const picker_id = picker.getAttribute('data-trigger-id'),
            $input = document.getElementById(picker_id).parentNode.querySelector(right_input_selector);
            
            $input.dispatchEvent(lccp_ivc_event(picker_id, true));
        }
        return true;
    });
    
    
    /* hide picker on screen resizing */
    window.addEventListener('resize', function(e) {
        const picker = document.querySelector("#lc-color-picker.lccp-shown");
        if(!picker || window_width == window.innerWidth) {
            return true;    
        }

        // check field value
        const picker_id = picker.getAttribute('data-trigger-id'),
              $input = document.getElementById(picker_id).parentNode.querySelector(right_input_selector);
        
        $input.dispatchEvent(lccp_ivc_event(picker_id, true));
    });
    
    
    /* tell the page that a field value changed - frameworks and form listeners only react to native events */
    const fire_field_events = function(field) {
        field.dispatchEvent(new Event('input', {bubbles: true}));
        field.dispatchEvent(new Event('change', {bubbles: true}));
    };
    
    
    /* replace every pattern in the "find" list - module-scoped so String.prototype is left untouched */
    const _replace_array = function(str, find, replace) {
        let replaceString = str;
        
        for (let i = 0; i < find.length; i++) {
            const regex = new RegExp(find[i], "g");
            replaceString = (typeof(replace) == 'object') ? replaceString.replace(regex, replace[i]) : replaceString.replace(regex, replace);
        }
        return replaceString;
    };
    
    
    
    
    /*** shared utilities - also used by the public gradient-data API ***/
    
    /* shorten a hex color when possible - non-hex values (named colors and the like) are returned untouched */
    const _shorten_hex = function(hex) {
        hex = (hex || '').toString().trim();
        
        const has_hash = (hex.charAt(0) === '#'),
              v = has_hash ? hex.substr(1) : hex;
              
        if(!/^[0-9a-f]+$/i.test(v) || (v.length !== 3 && v.length !== 6 && v.length !== 8)) {
            return hex;
        }
        if(v.length === 6 && v[0] === v[1] && v[2] === v[3] && v[4] === v[5]) {
            return '#'+ v[0] + v[2] + v[4];      
        }
        return '#'+ v;
    };
    
    
    /* expand a 3-digit hex to the 6-digit form */
    const _short_hex_fix = function(hex) {
        hex = (hex || '').toString().trim();
        
        if(/^#[0-9a-f]{3}$/i.test(hex)) {
            const a = hex.split('');
            hex = a[0] + a[1] + a[1] + a[2] + a[2] + a[3] + a[3];
        }
        return hex.toLowerCase();
    };
    
    
    /* convert RGB to hex */
    const _RGB_to_hex = function(rgb) {
        rgb = _replace_array(rgb, ['rgb', '\\(', '\\)'], '');
        const rgb_arr = rgb.split(',');
        
        if(rgb_arr.length < 3) { return '#000'; }
        
        let r = parseInt(rgb_arr[0].trim(), 10).toString(16),
            g = parseInt(rgb_arr[1].trim(), 10).toString(16),
            b = parseInt(rgb_arr[2].trim(), 10).toString(16);

        if (r.length == 1) {r = "0" + r;}
        if (g.length == 1) {g = "0" + g;}
        if (b.length == 1) {b = "0" + b;}
        
        return _shorten_hex(r + g + b);
    };
    
    
    /* handles RGBA string returning a two elements array: hex and alpha */
    const _RGBA_to_hexA = function(raw_data) {
        raw_data = _replace_array(raw_data, ['rgba', '\\(', '\\)'], '');
        const rgba_arr = raw_data.split(',');
        
        let alpha = (typeof(rgba_arr[3]) != 'undefined') ? rgba_arr[3] : '1';
        if(alpha.substring(0, 1) == '.') {
            alpha = 0 + alpha;
        }
        rgba_arr.splice(3, 1);

        return [ _RGB_to_hex('rgb('+ rgba_arr.join(',') +')'), parseFloat(alpha) ];
    };
    
    
    /* convert hex to RGB string */
    const _hex_to_RGB = function(h) {
        h = (h || '').toString().trim();
        let r = 0, g = 0, b = 0;

        if(/^#[0-9a-f]{3}$/i.test(h)) {
            r = "0x" + h[1] + h[1];
            g = "0x" + h[2] + h[2];
            b = "0x" + h[3] + h[3];
        } else if(/^#[0-9a-f]{6}$/i.test(h)) {
            r = "0x" + h[1] + h[2];
            g = "0x" + h[3] + h[4];
            b = "0x" + h[5] + h[6];
        }
        return "rgb("+ +r + ", " + +g + ", " + +b + ")";
    };
    
    
    /* convert hex + opacity to a CSS color */
    const _hex_to_RGBA = function(h, opacity) {
        const fixed = _short_hex_fix(h);
        
        // not a hex color: alpha can't be applied, keep the original notation instead of printing NaN
        
        if(!/^#[0-9a-f]{6}$/.test(fixed)) {
            return fixed;
        }
        if(parseFloat(opacity) === 1) {
            return _shorten_hex(fixed);    
        }
        let rgb = _hex_to_RGB(fixed);
        return rgb.replace('(', 'a(').replace(')', ', '+ opacity.toString().replace('0.', '.') +')');
    };
    
    
    /* hex -> [r,g,b] */
    const _hex_to_rgb_arr = function(h) {
        let fixed = _short_hex_fix(h || '#000000');
        if(/^#[0-9a-f]{8}$/.test(fixed)) { fixed = fixed.substr(0, 7); }
        
        // not a hex color: fall back to black instead of parsing garbage
        if(!/^#[0-9a-f]{6}$/.test(fixed)) {
            return [0, 0, 0];
        }
        const v = fixed.substr(1);
        return [
            parseInt(v.substr(0, 2), 16) || 0,
            parseInt(v.substr(2, 2), 16) || 0,
            parseInt(v.substr(4, 2), 16) || 0
        ];
    };
    
    
    const _lerp_num = function(a, b, t) {
        return Math.round((a + (b - a) * t) * 100) / 100;
    };
    
    
    const _lerp_color = function(a, b, t) {
        const ca = _hex_to_rgb_arr(a), cb = _hex_to_rgb_arr(b);
        let out = '#';
        for(let i = 0; i < 3; i++) {
            let v = Math.max(0, Math.min(255, Math.round(ca[i] + (cb[i] - ca[i]) * t)));
            let s = v.toString(16);
            out += (s.length == 1) ? '0'+ s : s;
        }
        return out;
    };
    
    
    /* ---- OKLCH helpers (only used by the opt-in "interpolation" modes) ---- */
    
    /* sRGB channel (0-255) -> linear light */
    const _srgb_to_linear = function(c) {
        c = c / 255;
        return (c <= 0.04045) ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    
    
    /* linear light -> hex channel, clipped to the sRGB gamut */
    const _linear_to_hex = function(v) {
        let c = (v <= 0.0031308) ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
        c = Math.max(0, Math.min(255, Math.round(c * 255)));
        
        const s = c.toString(16);
        return (s.length == 1) ? '0'+ s : s;
    };
    
    
    /* hex -> [L, C, H] in OKLCH */
    const _hex_to_oklch = function(hex) {
        const rgb = _hex_to_rgb_arr(hex).map(_srgb_to_linear),
              l   = 0.4122214708 * rgb[0] + 0.5363325363 * rgb[1] + 0.0514459929 * rgb[2],
              m   = 0.2119034982 * rgb[0] + 0.6806995451 * rgb[1] + 0.1073969566 * rgb[2],
              s   = 0.0883024619 * rgb[0] + 0.2817188376 * rgb[1] + 0.6299787005 * rgb[2],
              l_  = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s),
              L   = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
              a   = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
              b   = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;
        
        let H = Math.atan2(b, a) * 180 / Math.PI;
        if(H < 0) { H += 360; }
        
        return [L, Math.sqrt(a * a + b * b), H];
    };
    
    
    /* [L, C, H] -> hex */
    const _oklch_to_hex = function(L, C, H) {
        const rad = H * Math.PI / 180,
              a   = C * Math.cos(rad),
              b   = C * Math.sin(rad),
              l_  = L + 0.3963377774 * a + 0.2158037573 * b,
              m_  = L - 0.1055613458 * a - 0.0638541728 * b,
              s_  = L - 0.0894841775 * a - 1.2914855480 * b,
              l   = l_ * l_ * l_,
              m   = m_ * m_ * m_,
              s   = s_ * s_ * s_;
        
        return '#'+
            _linear_to_hex( 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s) +
            _linear_to_hex(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s) +
            _linear_to_hex(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
    };
    
    
    /* mix two hex colors in OKLCH - shortest hue arc, achromatic endpoints borrow the other hue */
    const _lerp_oklch = function(a, b, t) {
        const ca = _hex_to_oklch(a), cb = _hex_to_oklch(b);
        
        let dh = cb[2] - ca[2];
        if(dh > 180) { dh -= 360; }
        else if(dh < -180) { dh += 360; }
        
        let ha = ca[2], hb = ca[2] + dh;
        if(ca[1] < 0.0001) { ha = hb; }
        if(cb[1] < 0.0001) { hb = ha; }
        
        return _oklch_to_hex(
            ca[0] + (cb[0] - ca[0]) * t,
            ca[1] + (cb[1] - ca[1]) * t,
            ha + (hb - ha) * t
        );
    };
    
    
    /* smoothstep easing, applied to the color track only */
    const _smoothstep = function(t) {
        return t * t * (3 - 2 * t);
    };
    
    
    /* merge both tracks into one stop list
       - the color track is interpolated with the given lerp (and optional ease)
       - the opacity track is always interpolated linearly
       - grid_step adds uniformly spaced positions so the result approximates the oklch path */
    const _merge_stops = function(color_steps, opacity_steps, color_lerp, color_ease, grid_step) {
        const c_steps = (color_steps || []).slice().sort((a, b) => a.position - b.position),
              o_steps = (opacity_steps || []).slice().sort((a, b) => a.position - b.position);
        
        // group stops by position so stops sharing one are all emitted (hard edges)
        const group_by_pos = function(steps) {
            const map = {};
            steps.forEach((s) => {
                const p = parseInt(s.position, 10);
                if(isNaN(p)) { return; }
                (map[p] = map[p] || []).push(s);
            });
            return map;
        };
        const c_map = group_by_pos(c_steps),
              o_map = group_by_pos(o_steps),
              counts = {};
        
        // the most crowded track decides how many stops a position gets
        [c_map, o_map].forEach((map) => {
            Object.keys(map).forEach((p) => { counts[p] = Math.max(counts[p] || 0, map[p].length); });
        });
        
        // uniform positions inside the drawn range
        const pct = parseInt(grid_step, 10);
        if(pct > 0) {
            const all = c_steps.concat(o_steps).map((s) => parseInt(s.position, 10)).filter((p) => !isNaN(p));
            if(all.length) {
                const min = Math.min.apply(null, all),
                      max = Math.max.apply(null, all);
                      
                for(let p = Math.ceil(min / pct) * pct; p <= max; p += pct) {
                    counts[p] = counts[p] || 1;
                }
            }
        }
        
        const positions = Object.keys(counts).map((p) => parseInt(p, 10)).sort((a, b) => a - b);
        if(!positions.length) { 
            positions.push(0, 100); 
        }
        else if(positions.length === 1) {
            positions.push((positions[0] === 0) ? 100 : 0);
            positions.sort((a, b) => a - b);
        }
        
        const out = [];
        positions.forEach((pos) => {
            const repeat = Math.max(counts[pos] || 1, 1);
            
            for(let i = 0; i < repeat; i++) {
                const c_step = (c_map[pos] || [])[i],
                      o_step = (o_map[pos] || [])[i],
                      color  = (c_step && c_step.color) ? c_step.color : _track_value_at(c_steps, pos, 'color', color_lerp, color_ease) || '#000000',
                      op     = (o_step && typeof(o_step.opacity) != 'undefined') ? o_step.opacity : _track_value_at(o_steps, pos, 'opacity', _lerp_num),
                      opacity = parseFloat(op);
                
                out.push({ pos: pos, color: color, opacity: isNaN(opacity) ? 1 : Math.max(0, Math.min(1, opacity)) });
            }
        });
        
        return out;
    };
    
    
    /* both tracks -> CSS gradient string; "oklch-css" adds the interpolation hint instead of a grid */
    const build_gradient_css = function(mode, deg, radial_circle, color_steps, opacity_steps, transparency, interpolation, step) {
        let list;
        
        if(interpolation == 'oklch' || interpolation == 'oklch-smoothstep') {
            list = _merge_stops(color_steps, opacity_steps, _lerp_oklch, (interpolation == 'oklch-smoothstep') ? _smoothstep : null, step);
        }
        else if(interpolation == 'oklch-css') {
            // no grid, but the anchors still have to be synthesised on the oklch curve
            list = _merge_stops(color_steps, opacity_steps, _lerp_oklch, null, null);
        }
        else {
            list = _merge_stops(color_steps, opacity_steps, _lerp_color, null, null);
        }
        
        const method = (interpolation == 'oklch-css') ? 'in oklch ' : '',
              parts  = list.map((s) => {
                  const op  = (typeof(s.opacity) == 'undefined') ? 1 : s.opacity,
                        col = (!transparency) ? _shorten_hex(s.color) : _hex_to_RGBA(_short_hex_fix(s.color), op);
                  return col +' '+ s.pos +'%';
              });
        
        return mode +'('+ method + ((mode == 'linear-gradient') ? deg +'deg' : (radial_circle) ? 'circle' : 'ellipse') +', '+ parts.join(', ') +')';
    };
    
    
    /* value of a track at a given position (single-stop tracks behave as constants) */
    const _track_value_at = function(steps, pos, key, lerp, ease) {
        if(!steps || !steps.length) { return null; }
        const sorted = steps.slice().sort((a, b) => a.position - b.position);
        
        if(sorted.length === 1 || pos <= sorted[0].position) { return sorted[0][key]; }
        if(pos >= sorted[sorted.length - 1].position) { return sorted[sorted.length - 1][key]; }
        
        for(let i = 0; i < sorted.length - 1; i++) {
            if(pos >= sorted[i].position && pos <= sorted[i+1].position) {
                const span = sorted[i+1].position - sorted[i].position;
                let t = span ? (pos - sorted[i].position) / span : 0;
                if(ease) { t = ease(t); }
                return lerp(sorted[i][key], sorted[i+1][key], t);
            }
        }
        return sorted[sorted.length - 1][key];
    };
    
    
    /* parse a CSS gradient string into {deg, radial_circle, steps} */
    const parse_gradient_css = function(raw_data) {
        // drop the interpolation hint sitting right after the opening parenthesis:
        // linear-gradient(in oklch 90deg, ...) / linear-gradient(in oklch, ...) / radial-gradient(in oklch circle, ...)
        raw_data = raw_data.replace(/^(\s*[a-z-]*-gradient\s*\(\s*)in\s+[a-z]+(?:-[a-z]+)*(?:\s+(?:longer|shorter|increasing|decreasing)\s+hue)?\s*,?\s*/i, '$1');
        
        const is_radial = (raw_data.indexOf('radial-gradient') === -1) ? false : true;
        let deg = 0, radial_circle = false;
        
        // solve issues with inner RGB|RGBA and turn everything into RGBA
        raw_data = raw_data
            .replace(/,\./g, ',0.').replace(/ \./g, ' 0.')
            .replace(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d+(?:\.\d+)?))?\)/g, 'rgbaZ($1|$2|$3|$4)')
            .replace(/\|\)/g, '|1)');

        // names to deg
        raw_data = raw_data 
            .replace('top right', '45deg').replace('right top', '45deg')
            .replace('bottom right', '135deg').replace('bottom right', '135deg')
            .replace('top left', '315deg').replace('left top', '315deg')
            .replace('bottom left', '225deg').replace('bottom left', '225deg')
            .replace('right', '90deg').replace('left', '270deg').replace('top', '0deg').replace('bottom', '180deg');
            
        // process - "to" is only stripped as a standalone keyword (color names like "tomato" must survive)
        raw_data = _replace_array(
            raw_data, ['linear-gradient', 'radial-gradient', '', '\\(', '\\bto\\b', '\\)'], 
            ''
        );
            
        // split steps
        const raw_steps = raw_data.split(',');
        
        // without a declared direction/shape the first segment is a color: restore it as a virtual first segment
        const first_seg = raw_steps[0].trim().toLowerCase(),
              has_dir = (is_radial) ? 
                    /circle|ellipse|closest|farthest|\bat\b/.test(first_seg) : 
                    first_seg.indexOf('deg') !== -1;
                    
        if(!has_dir) {
            raw_steps.unshift((is_radial) ? 'ellipse' : '180deg');
        }
        
        const fallback_multiplier = 100 / raw_steps.length;
        const steps = [];
        
        raw_steps.some(function(raw_step, index) {
            // direction on first index
            if(!index) {
                if(is_radial) {
                    radial_circle = (raw_step.indexOf('circle') === -1) ? false : true;
                } else {
                    deg = parseInt(raw_step.replace('deg', ''), 10);
                    if(isNaN(deg)) { deg = 0; }
                }
            }
            else {
                raw_step = raw_step.trim().split(' ');    
                let position = '';
                
                if(raw_step.length < 2) {
                    if(index === 1) { position = '0%'; }
                    else if(index == (raw_steps.length - 1)) { position = '100%'; }
                    else { position = (fallback_multiplier * index) +'%'; }
                }
                else { position = raw_step[1]; }
                
                let raw_color = raw_step[0], opacity = 1;
                
                // "transparent" keyword -> fully transparent black
                if(raw_color.toLowerCase() === 'transparent') {
                    raw_color = '#000000';
                    opacity = 0;
                }
                else if(raw_color.indexOf('rgbaZ') !== -1) {
                    const col_arr = _RGBA_to_hexA(raw_color.replace('rgbaZ', 'rgba').replace(/\|/g, ','));
                    raw_color = col_arr[0];
                    opacity = col_arr[1];
                }
                else if(/^#[0-9a-f]{8}$/i.test(raw_color)) {
                    opacity = Math.round(parseInt(raw_color.substr(7, 2), 16) / 255 * 100) / 100;
                    raw_color = raw_color.substr(0, 7);
                }
                
                steps.push({
                    color    : _short_hex_fix(raw_color), 
                    opacity  : opacity, 
                    position : parseInt(position, 10)              
                }); 
            }
        });
        
        // a gradient with a single stop is valid CSS: keep a usable step instead of an empty array
        if(!steps.length) {
            steps.push({ color: '#000000', opacity: 1, position: 0 }); 
        }
        
        return { deg: deg, radial_circle: radial_circle, steps: steps };
    };
    
    
    /* CSS gradient -> lossless dual-track structure */
    const css_to_dual = function(css) {
        const parsed = parse_gradient_css(css);
        return {
            deg: parsed.deg,
            radial_circle: parsed.radial_circle,
            color_steps: parsed.steps.map((s) => { return {color: s.color, position: s.position}; }),
            opacity_steps: parsed.steps.map((s) => { return {opacity: s.opacity, position: s.position}; })
        };
    };
    
    
    
    
    /* nearest free integer position on a track (0-100), keeping pos when available */
    const _free_position = function(taken, pos) {
        if(taken.indexOf(pos) === -1) { return pos; }
        
        for(let d = 1; d <= 100; d++) {
            if(pos + d <= 100 && taken.indexOf(pos + d) === -1) { return pos + d; }
            if(pos - d >= 0 && taken.indexOf(pos - d) === -1) { return pos - d; }
        }
        return pos;
    };
    
    
    /* validate / normalize external single-track steps */
    const _normalize_steps = function(arr) {
        const out = [];
        
        (Array.isArray(arr) ? arr : []).forEach((s) => {
            if(!s || typeof(s) != 'object') { return; }
            
            let pos = parseInt(s.position, 10);
            if(isNaN(pos)) { pos = 0; }
            pos = Math.max(0, Math.min(100, pos));
            
            let color = _short_hex_fix(s.color || '#000000');
            if(color === 'transparent') { color = '#000000'; }
            if(color.length >= 9) { color = color.substr(0, 7); }
            
            let opacity = parseFloat(s.opacity);
            if(isNaN(opacity)) { opacity = 1; }
            
            out.push({ color: color, opacity: Math.max(0, Math.min(1, opacity)), position: pos });
        });
        
        if(!out.length) { out.push({ color: '#000000', opacity: 1, position: 0 }); }
        return out.sort((a, b) => a.position - b.position);
    };
    
    
    /* validate / normalize external dual-track data */
    const normalize_dual_data = function(data) {
        const norm_steps = (arr, key, def) => {
            let out = [];
            if(Array.isArray(arr)) {
                arr.forEach((s) => {
                    if(!s || typeof(s) != 'object') { return; }
                    let pos = parseInt(s.position, 10);
                    if(isNaN(pos)) { pos = 0; }
                    pos = Math.max(0, Math.min(100, pos));
                    
                    let v = s[key];
                    if(key == 'opacity') {
                        v = parseFloat(v);
                        if(isNaN(v)) { v = 1; }
                        v = Math.max(0, Math.min(1, v));
                    }
                    else {
                        v = _short_hex_fix(v || '#000000');
                        if(v === 'transparent') { v = '#000000'; }
                        if(v.length >= 9) { v = v.substr(0, 7); }
                    }
                    const step = {position: pos};
                    step[key] = v;
                    out.push(step);
                });
            }
            if(!out.length) {
                const step = {position: 0};
                step[key] = def;
                out.push(step);
            }
            return out.sort((a, b) => a.position - b.position);
        };
        
        let deg = parseInt(data.deg, 10);
        if(isNaN(deg)) { deg = 90; }
        
        return {
            deg: deg,
            radial_circle: !!data.radial_circle,
            color_steps: norm_steps(data.color_steps, 'color', '#000000'),
            opacity_steps: norm_steps(data.opacity_steps, 'opacity', 1)
        };
    };
    
    
    /* global drag handling for gradient stops (bound once) */
    document.addEventListener('mousemove', (e) => { if(drag_state) { drag_state.onMove(e); } });
    document.addEventListener('touchmove', (e) => { if(drag_state) { drag_state.onMove(e); } }, {passive: false});
    
    const end_stop_drag = function() {
        if(!drag_state) { return; }
        const cb = drag_state.onEnd;
        drag_state = null;
        cb();
    };
    document.addEventListener('mouseup', end_stop_drag);
    document.addEventListener('touchend', end_stop_drag);
    
    
    
    /*** plugin class ***/
    window.lc_color_picker = function(attachTo, options = {}) {
        let debounced_vars = [], // per-instance debounce timers
            last_tracked_col;
        
        this.attachTo = attachTo;
        if(!this.attachTo) {
            return console.error('You must provide a valid selector string first argument');
        }
    
        // override options
        if(typeof(options) !=  'object') {
            return console.error('Options must be an object');    
        }
        
        const bkp_opts = options;
        options = Object.assign({}, def_opts, options);
        
        if(typeof(bkp_opts.preview_style) != 'undefined') {
            options.preview_style = Object.assign({}, def_opts.preview_style, bkp_opts.preview_style);    
        }
        
        // dual tracks only apply to instances supporting gradients; when enabled the preview always covers the whole field
        const dual_mode = !!options.dual_tracks && (
            options.modes.indexOf('linear-gradient') !== -1 || options.modes.indexOf('radial-gradient') !== -1
        );
        if(dual_mode) {
            options.no_input_mode = true;
        }
        
        // 'srgb' keeps the original behaviour; the oklch modes either resample here or defer to the browser
        const interp_mode = (['oklch', 'oklch-smoothstep', 'oklch-css'].indexOf(options.interpolation) === -1) ? 'srgb' : options.interpolation,
              interp_resample = (interp_mode == 'oklch' || interp_mode == 'oklch-smoothstep'),
              single_lossless = interp_resample; // resampling replaces the stops: keep the originals on the field
        
    
        
        /* initialize */
        this.init = function() {
            const $this = this;
            
            // Generate style
            if(!style_generated) {
                this.generate_style();
                style_generated = true;
            }
            
            
            // assign to each target element
            maybe_querySelectorAll(attachTo).forEach(function(el) {
                if(el.tagName == 'INPUT' && el.getAttribute('type') != 'text') {
                    return;    
                }
                
                // do not initialize twice
                if(el.parentNode.classList.length && el.parentNode.classList.contains('lccp-el-wrap')) {
                    return;    
                }

                $this.wrap_element(el);
            });
        };
    
        
        
        /* wrap target element to allow trigger display */
        this.wrap_element = function(el) {
            // one unique ID per wrapped element (not per instance: an instance may target many fields)
            const uniqid = 'lccp_'+ Math.random().toString(36).substr(2, 9);
            
            const $this     = this,
                  side_prop = (options.preview_style.side == 'right') ? 'borderRightWidth' : 'borderLeftWidth';

            let trigger_css =
                `width:${ (options.no_input_mode) ? 'calc(100% - '+ parseInt(getComputedStyle(el)['borderRightWidth'], 10) +'px - '+ parseInt(getComputedStyle(el)['borderLeftWidth'], 10) +'px);' : options.preview_style.width +'px;'}` +
                
                options.preview_style.side +':'+ parseInt(getComputedStyle(el)[side_prop], 10) +'px;'+
                
                'top:'+ parseInt(getComputedStyle(el)['borderTopWidth'], 10) +'px;' +
                
                'height: calc(100% - '+ parseInt(getComputedStyle(el)['borderTopWidth'], 10) +'px - '+ parseInt(getComputedStyle(el)['borderBottomWidth'], 10) +'px);';
            
            let trigger_upper_css = 
                trigger_css + 
                'background:'+ el.value +';' +
                'border-color:'+ options.preview_style.separator_color +';'
            
            let div = document.createElement('div');
            div.className = 'lccp-preview-'+ options.preview_style.side;
            div.setAttribute('data-for', el.getAttribute('name'));
            
            // static width from input?
            if(options.wrap_width != 'auto') {
                div.style.width = (options.wrap_width == 'inherit') ? Math.round(el.getBoundingClientRect().width) + 'px' : options.wrap_width; 
            }
            
            const direct_colorpicker_code = (!options.transparency && options.modes.length == 1 && options.modes[0] == 'solid') ? 
                '<input type="color" name="'+ uniqid +'_direct_cp" value="'+ el.value +'" class="lccp-direct-cp-f" />' : '';
            
            div.classList.add("lccp-el-wrap");
            div.innerHTML = 
                '<span class="lccp-preview-bg" style="'+ trigger_css +'"></span>' +
                '<span id="'+ uniqid +'" class="lccp-preview" style="'+ trigger_upper_css +'" title="'+ options.labels[0] +'" role="button" tabindex="0" aria-label="'+ options.labels[0] +'"></span>' +
                direct_colorpicker_code;

            el.parentNode.insertBefore(div, el);
            div.appendChild(el);
            
            field_instances.set(el, {
                picker  : this,
                options : {
                    transparency       : options.transparency,
                    interpolation      : interp_mode,
                    interpolation_step : options.interpolation_step
                }
            });
            
            // input padding
            if(!options.no_input_mode) {
                if(options.preview_style.side == 'right') {
                    div.querySelector('input:not([type="color"])').style.paddingRight = options.preview_style.input_padding +'px';
                } else {
                    div.querySelector('input:not([type="color"])').style.paddingLeft = options.preview_style.input_padding +'px';      
                }
            }
            
            
            // direct browser colorpicker? track changes
            if(div.querySelector('.lccp-direct-cp-f')) {
                div.querySelector('.lccp-direct-cp-f').addEventListener("input", (e) => {
                    const field = div.querySelector('input:not([type="color"])'),
                          val   = e.target.value;
                    
                    field.value = val;
                    div.querySelector('.lccp-preview').style.background = val;
                    last_tracked_col = val;
                    
                    if(typeof(options.on_change) == 'function') {
                        options.on_change.call(this, val, field);
                    }
                    fire_field_events(field);
                });        
            }
            
            
            // event to show picker
            const trigger = document.getElementById(uniqid);
            trigger.addEventListener("click", (e) => {
                this.show_picker(trigger);
            }); 
            
            // the trigger is a role="button" span: honour Enter and Space
            trigger.addEventListener("keydown", (e) => {
                if(e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                    e.preventDefault();
                    this.show_picker(trigger);
                }
            });
            
            
            
            // show on field focus?
            if(options.open_on_focus) {
                div.querySelector(right_input_selector).addEventListener("focus", (e) => {
                    if(trigger != active_trigger) {
                        if(active_trigger) {
                            document.getElementById('lc-color-picker').classList.remove('lccp-shown');
                            active_trigger = null;
                        }
                        
                        $this.debounce('open_on_focus', 10, 'show_picker', trigger); 
                    }
                });
            }
            
            
            // sync manually-inputed data in the field
            div.querySelector(right_input_selector).addEventListener("keyup", (e) => {
                if(e.keyCode == 9 || e.key === 'Enter' || e.keyCode === 13) {
                    return;   
                }
                
                const is_active_trigger_and_opened = document.querySelector("#lc-color-picker.lccp-shown") ? true : false;
                
                active_trigger = trigger;
                active_trig_id = uniqid;
                
                $this.debounce('manual_input_sync', 510, 'val_to_picker', true);
                
                if(is_active_trigger_and_opened) {
                    $this.debounce('manual_input_sync_cp', 500, 'append_color_picker', false);
                    $this.debounce('reopen_picker_after_manual_edit', 510, 'show_picker', trigger);
                }
            });
            
            
            // be sure input value is managed on focusout
            div.querySelector(right_input_selector).addEventListener("focusout", (e) => {
                const shown_picker = document.querySelector('#lc-color-picker.lccp-shown[data-trigger-id="'+ active_trig_id +'"]');
                
                // not if this field's picker is shown and the focus was dropped (body) or moved
                // inside the panel itself - gradient stops take the focus on press
                if(shown_picker && (
                    !document.activeElement || 
                    document.activeElement.tagName == 'BODY' || 
                    shown_picker.contains(document.activeElement) || 
                    (e.relatedTarget && shown_picker.contains(e.relatedTarget))
                )) {
                    return true;    
                }
                
                e.target.dispatchEvent(lccp_ivc_event(active_trig_id, true));
            });
            
            
            // custom event - check field validity and eventually use fallback values
            div.querySelector(right_input_selector).addEventListener("lccp_input_val_check", (e) => {
                const curr_val = e.target.value,
                      test = document.createElement('div');
                
                test.style.background = curr_val;
                let browser_val = test.style.background,
                    val_to_set;
                
                // dual-track gradients are generated by the plugin: don't let the browser rewrite them
                // (otherwise the lossless data signature would stop matching the field value)
                let keep_value = false;
                if(dual_mode && e.target.dataset && e.target.dataset.lccpTracks && curr_val.toLowerCase().indexOf('gradient') !== -1 && browser_val) {
                    try {
                        keep_value = (JSON.parse(e.target.dataset.lccpTracks).css || '').trim().toLowerCase() === curr_val.trim().toLowerCase();
                    } catch(err) { keep_value = false; }
                }
                // the same applies to solid values stored as 8-digit hex
                else if(options.solid_hex8 && /^#[0-9a-f]{8}$/i.test(curr_val.trim()) && browser_val) {
                    keep_value = true;
                }
                // browsers without "in oklch" support report the value as invalid: never replace it
                else if(curr_val.toLowerCase().indexOf('in oklch') !== -1) {
                    keep_value = true;
                }
                
                if(keep_value) {
                    val_to_set = curr_val;
                }
                else if(!curr_val.trim().length || !browser_val) {
                    if(e.target.value.toLowerCase().indexOf('gradient') === -1) {
                        val_to_set = (options.fallback_colors[0].toLowerCase().indexOf('rgba') === -1) ? $this.RGB_to_hex(options.fallback_colors[0]) : options.fallback_colors[0];   
                    }
                    else {
                        val_to_set = options.fallback_colors[1];     
                    }
                }
                else {
                    // browser already fixes minor things
                    browser_val = browser_val.replace(/0\./g, '.').replace(/rgb\([^\)]+\)/g, (rgb) => {
                        return $this.RGB_to_hex(rgb);
                    });
                    
                    val_to_set = (browser_val.trim().toLowerCase().substr(0, 4) == 'rgb(') ? $this.RGB_to_hex(browser_val) : browser_val; 
                }
                
                if(val_to_set != curr_val) {
                    e.target.value = val_to_set;
                }
                
                if(typeof(options.on_change) == 'function' && last_tracked_col != val_to_set) {
                    options.on_change.call($this, val_to_set, e.target);
                }
                
                if(e.detail.picker_id == active_trig_id) {
                    active_trigger = null;
                    active_trig_id = null;
                }
                
                
                // also hide picker?
                const $target = document.querySelector('#lc-color-picker.lccp-shown[data-trigger-id="'+ e.detail.picker_id +'"]');
                if($target) {
                    
                    $target.classList.remove('lccp-shown');
                    document.getElementById("lc-color-picker").remove(); 
                }
            });
        };
        
        
        
        /* show picker */
        this.show_picker = function(trigger) {
            if(document.querySelector('#lc-color-picker.lccp-shown[data-trigger-id="'+ active_trig_id +'"]')) {
                document.getElementById("lc-color-picker").remove();
                active_trigger = null;
                active_trig_id = null
                
                return false;
            }
            
            // direct colorpicker usage? Not for Firefox is "show on focus" is enabled
            const direct_colorpicker = trigger.parentNode.querySelector('.lccp-direct-cp-f');
            if(
                direct_colorpicker && 
                (
                    !options.open_on_focus || 
                    (options.open_on_focus && !navigator.userAgent.toLowerCase().includes('firefox'))
                )
            ) {
                direct_colorpicker.value = active_solid; 
                direct_colorpicker.click();
                return true;   
            }
            
            
            window_width = window.innerWidth;
            active_trigger = trigger;
            active_trig_id = trigger.id;
            
            this.val_to_picker();
            this.append_color_picker();
            
            const picker      = document.getElementById('lc-color-picker'),
                  picker_w    = picker.offsetWidth,
                  picker_h    = picker.offsetHeight,
                  at_offsety  = active_trigger.getBoundingClientRect(),
                  at_h        = parseInt(active_trigger.clientHeight, 10) + parseInt(getComputedStyle(active_trigger)['borderTopWidth'], 10) + parseInt(getComputedStyle(active_trigger)['borderBottomWidth'], 10),
                  y_pos       = (parseInt(at_offsety.y, 10) + parseInt(window.pageYOffset, 10) + at_h + 5);

            // left pos control - also checking side overflows
            let left = (parseInt(at_offsety.right, 10) - picker_w);
            if(left < 0) {
                left = 0;
            }
            
            // mobile? show it centered
            if(window.innerWidth < 700) {
                left = Math.floor( (window.innerWidth - picker_w) / 2);    
            }
            
            // top or bottom ?   
            const fits_below = (y_pos + picker_h - document.documentElement.scrollTop < window.innerHeight),
                  y_pos_css  = (fits_below) ? 
                    'top:'+ y_pos : 
                    'transform: translate3d(0, calc((100% + '+ (active_trigger.offsetHeight + 10) +'px) * -1), 0); top:'+ y_pos; 

            picker.setAttribute('style', y_pos_css +'px; left: '+ left +'px;');  
            
            // anchored upwards the panel grows opposite to the pointer: the editor rows have
            // to keep their space (disabled instead of hidden) or the stops jump on selection
            picker.classList.toggle('lccp_up', !fits_below);
            this.sync_dual_fields();
            
            picker.classList.add('lccp-shown');
        };
        
        
        
        /* handles input value and prepres data for the picker */
        this.val_to_picker = function(from_manual_input) {
            if(!active_trigger) {
                return false;    
            }
            dual_active = dual_mode;
            const val = active_trigger.parentNode.querySelector(right_input_selector).value.trim().toLowerCase();   
            last_tracked_col = val;
            
            // check validity
            let test = document.createElement('div');
            test.style.background = val;
            
            //// set active colors
            // if no value found
            if(!val.length || !test.style.background.length) {
                active_solid = options.fallback_colors[0];
                active_gradient = options.fallback_colors[1];
                
                if(val.indexOf('linear-gradient') !== -1) {
                    active_mode = 'linear-gradient';        
                } 
                else if(val.indexOf('radial-gradient') !== -1) {
                    active_mode = 'radial-gradient';   
                }
                else {
                    active_mode = 'solid';       
                }
            }
            else {
                
                // find which value type has been passed
                if(val.indexOf('linear-gradient') !== -1) {
                    active_mode = 'linear-gradient';       
                }
                else if(val.indexOf('radial-gradient') !== -1) {
                    active_mode = 'radial-gradient';       
                }
                else {
                    active_mode = 'solid';    
                }
                
                if(active_mode == 'solid') {
                    active_solid = val;
                    active_gradient = options.fallback_colors[1];
                }
                else{
                    active_solid = options.fallback_colors[0];
                    active_gradient = val;        
                }
            }
            active_trigger.style.background = val;
            
            if(!from_manual_input || (from_manual_input && options.open_on_focus)) {
                // elaborate solid color data (color and alpha)
                this.load_solid_data(active_solid);

                // elaborate gradient data
                sel_track = null;
                sel_grad_step = 0;
                if(active_gradient) {
                    const field = active_trigger.parentNode.querySelector(right_input_selector);
                    
                    if(dual_active) {
                        this.load_dual_data(field, active_gradient);
                    }
                    else if(single_lossless) {
                        this.load_single_data(field, active_gradient);
                    }
                    else {
                        this.load_gradient_data(active_gradient);
                    }
                }
            }
        };
        
        
        
        /* elaborate solid color data (color and alpha) loading into active_solid and active_opacity */
        this.load_solid_data = function(raw_data) {
            active_opacity = 1;
            raw_data = (raw_data || '').trim().toLowerCase();
            
            // 8-digit hex (#RRGGBBAA)
            if(/^#[0-9a-f]{8}$/i.test(raw_data)) {
                active_solid = raw_data.substr(0, 7);
                active_opacity = Math.round(parseInt(raw_data.substr(7, 2), 16) / 255 * 100) / 100;
            }
            
            // rgba
            else if(raw_data.indexOf('rgba') !== -1) {
                const data = this.RGBA_to_hexA(raw_data);
                active_solid = data[0];
                active_opacity = data[1];
            }
            
            // rgb
            else if(raw_data.indexOf('rgb') !== -1) {
                active_solid = this.RGB_to_hex(raw_data);        
            }
            
            // hex
            else {
                active_solid = this.short_hex_fix(raw_data);    
            }
        };
        
        
        
        /* load lossless dual-track data: from the field dataset when still in sync, otherwise rebuild from the CSS value */
        this.load_dual_data = function(field, css) {
            let data = null;
            
            if(field && field.dataset && field.dataset.lccpTracks) {
                try {
                    const stored = JSON.parse(field.dataset.lccpTracks);
                    if(stored && (stored.css || '').trim().toLowerCase() === field.value.trim().toLowerCase()) {
                        data = normalize_dual_data(stored);
                    }
                } catch(err) { data = null; }
            }
            
            if(!data) {
                data = normalize_dual_data(css_to_dual(css));
            }
            
            gradient_data.deg = data.deg;
            gradient_data.radial_circle = data.radial_circle;
            gradient_data.color_steps = data.color_steps;
            gradient_data.opacity_steps = data.opacity_steps;
        };
        
        
        
        /* save lossless dual-track data on the target field */
        this.save_dual_data = function(css) {
            if(!active_trigger) { return false; }
            const field = active_trigger.parentNode.querySelector(right_input_selector);
            if(!field) { return false; }
            
            const json = JSON.stringify({
                css             : css,
                deg             : gradient_data.deg,
                radial_circle   : gradient_data.radial_circle,
                color_steps     : gradient_data.color_steps,
                opacity_steps   : gradient_data.opacity_steps
            });
            
            // report whether the tracks actually changed: the CSS can stay identical while they move
            if(field.dataset.lccpTracks === json) { return false; }
            field.dataset.lccpTracks = json;
            return true;
        };
        
        
        
        /* load lossless single-track data - only written by the resampling interpolation modes */
        this.load_single_data = function(field, css) {
            let data = null;
            
            if(field && field.dataset && field.dataset.lccpStops) {
                try {
                    const stored = JSON.parse(field.dataset.lccpStops);
                    if(stored && (stored.css || '').trim().toLowerCase() === field.value.trim().toLowerCase()) {
                        data = stored;
                    }
                } catch(err) { data = null; }
            }
            
            if(data) {
                const deg = parseInt(data.deg, 10);
                gradient_data.deg = isNaN(deg) ? 0 : deg;
                gradient_data.radial_circle = !!data.radial_circle;
                gradient_data.steps = _normalize_steps(data.steps);
            }
            else {
                this.load_gradient_data(css);
            }
        };
        
        
        /* save lossless single-track data on the target field */
        this.save_single_data = function(css) {
            if(!active_trigger) { return false; }
            const field = active_trigger.parentNode.querySelector(right_input_selector);
            if(!field) { return false; }
            
            const json = JSON.stringify({
                css             : css,
                deg             : gradient_data.deg,
                radial_circle   : gradient_data.radial_circle,
                steps           : gradient_data.steps
            });
            
            if(field.dataset.lccpStops === json) { return false; }
            field.dataset.lccpStops = json;
            return true;
        };
        
        
        /* elaborate gradient data loading into gradient_data (shares the parser with the dual-track path) */
        this.load_gradient_data = function(raw_data) {
            const parsed = parse_gradient_css(raw_data);
            
            gradient_data.deg = parsed.deg;
            gradient_data.radial_circle = parsed.radial_circle;
            gradient_data.steps = parsed.steps;
        };


        
        /* handles RGBA string returning a two elements array: hex and alpha  */
        this.RGBA_to_hexA = function(raw_data) {
            raw_data = _replace_array(raw_data, ['rgba', '\\(', '\\)'], '');
            const rgba_arr = raw_data.split(',')
            
            let alpha = (typeof(rgba_arr[3]) != 'undefined') ? rgba_arr[3] : '1';
            if(alpha.substring(0, 1) == '.') {
                alpha = 0 + alpha;
            }
            rgba_arr.splice(3, 1);

            return [
                this.RGB_to_hex('rgb('+ rgba_arr.join(',') +')'),
                parseFloat(alpha)
            ];
        };
        
        
        
        /* convert RGB to hex */
        this.RGB_to_hex = function(rgb) {
            rgb = _replace_array(rgb, ['rgb', '\\(', '\\)'], '');
            const rgb_arr = rgb.split(',');
            
            if(rgb_arr.length < 3) {
                return '#000';    
            }
            
            let r = parseInt(rgb_arr[0].trim(), 10).toString(16),
                g = parseInt(rgb_arr[1].trim(), 10).toString(16),
                b = parseInt(rgb_arr[2].trim(), 10).toString(16);

            if (r.length == 1) {r = "0" + r;}
            if (g.length == 1) {g = "0" + g;}
            if (b.length == 1) {b = "0" + b;}
            
            return this.shorten_hex(r + g + b);
        };
        
        
        
        /* if possible, shortenize hex string - non-hex values (named colors and the like) are returned untouched */
        this.shorten_hex = function(hex) {
            hex = (hex || '').toString().trim();
            
            const has_hash = (hex.charAt(0) === '#'),
                  v = has_hash ? hex.substr(1) : hex;
                  
            if(!/^[0-9a-f]+$/i.test(v) || (v.length !== 3 && v.length !== 6 && v.length !== 8)) {
                return hex;
            }
            if(v.length === 6 && v[0] === v[1] && v[2] === v[3] && v[4] === v[5]) {
                return '#'+ v[0] + v[2] + v[4];      
            }
            
            return '#'+ v;
        };
        
        
        
        /* convert short hex to full format */
        this.short_hex_fix = function(hex) {
            hex = (hex || '').toString().trim();
            
            if(/^#[0-9a-f]{3}$/i.test(hex)) {
                const a = hex.split('');
                hex = a[0] + a[1] + a[1] + a[2] + a[2] + a[3] + a[3];
            }

            return hex.toLowerCase();
        };
        
        
        
        /* convert hex to RGB */
        this.hex_to_RGB = function(h) {
            h = (h || '').toString().trim();
            let r = 0, g = 0, b = 0;

            // 3 digits
            if (/^#[0-9a-f]{3}$/i.test(h)) {
                r = "0x" + h[1] + h[1];
                g = "0x" + h[2] + h[2];
                b = "0x" + h[3] + h[3];

                // 6 digits
            } else if (/^#[0-9a-f]{6}$/i.test(h)) {
                r = "0x" + h[1] + h[2];
                g = "0x" + h[3] + h[4];
                b = "0x" + h[5] + h[6];
            }

            return "rgb("+ +r + ", " + +g + ", " + +b + ")";
        };
        
        
        
        /* convert hex to RGB */
        this.hex_to_RGBA = function(h, opacity) {
            const fixed = this.short_hex_fix(h);
            
            // not a hex color: alpha can't be applied, keep the original notation instead of printing NaN
            if(!/^#[0-9a-f]{6}$/.test(fixed)) {
                return fixed;
            }
            if(parseFloat(opacity) === 1) {
                return this.shorten_hex(fixed);    
            }
            
            let rgb = this.hex_to_RGB(fixed);
            return rgb.replace('(', 'a(').replace(')', ', '+ opacity.toString().replace('0.', '.') +')');
        };
        
        
        
        
        /* append color container picker to the body */
        this.append_color_picker = function(on_manual_input_change = false) {
            const $this = this;
            
            if(document.getElementById("lc-color-picker") && !on_manual_input_change) {
                document.getElementById("lc-color-picker").remove();
            }
            
            const theme_class     = (options.dark_theme) ? 'lccp_dark_theme' : 'lccp_light_theme', 
                  bg              = (active_mode == 'solid') ? active_solid : active_gradient,
                  graduated       = dual_active && active_mode != 'solid',
                  shown_solid     = (graduated) ? (gradient_data.color_steps[0] || {color:'#000000'}).color : (active_mode == 'solid') ? active_solid : gradient_data.steps[0].color,
                  shown_opacity   = (graduated) ? (gradient_data.opacity_steps[0] || {opacity:1}).opacity : (active_mode == 'solid') ? active_opacity : (options.transparency) ? gradient_data.steps[0].opacity : null,      
                  print_grad_code = (options.modes.indexOf('linear-gradient') !== -1 || options.modes.indexOf('radial-gradient') !== -1) ? true : false;
            
            
            // id of the trigger driving this panel, used to match the panel back to its field
            const trig_id = (active_trigger) ? active_trigger.id : '';
            
            // start code
            let picker = '',
                picker_el;
            
            if(on_manual_input_change && document.getElementById("lc-color-picker")) { 
                picker_el = document.getElementById("lc-color-picker");
                picker_el.setAttribute('data-mode', active_mode);
                picker_el.setAttribute('data-trigger-id', trig_id);
            }
            else {
                picker = '<div id="lc-color-picker" class="'+ theme_class +'" data-mode="'+ active_mode +'" data-trigger-id="'+ trig_id +'">';
            }

            
            // modes select
            if(options.modes.length > 1) {
                picker += `
                <div id="lccp_modes_wrap">
                    <span class="${(active_mode == 'solid') ? 'lccp_sel_mode' : ''}" ${(options.modes.indexOf('solid') === -1) ? 'style="display: none;"' : ''} data-mode="solid">${ options.labels[1] }</span>
                    <span class="${(active_mode == 'linear-gradient') ? 'lccp_sel_mode' : ''}" ${(options.modes.indexOf('linear-gradient') === -1) ? 'style="display: none;"' : ''} data-mode="linear-gradient">${ options.labels[2] }</span>
                    <span class="${(active_mode == 'radial-gradient') ? 'lccp_sel_mode' : ''}" ${(options.modes.indexOf('radial-gradient') === -1) ? 'style="display: none;"' : ''} data-mode="radial-gradient">${ options.labels[3] }</span>
                </div>`;
            }
            
            
            // gradient wizard
            if(print_grad_code) {
                picker += `
                <div class="lccp_gradient_wizard${ (dual_active) ? ' lccp_dual_tracks' : '' }" ${ (active_mode == 'solid') ? 'style="display: none;"' : '' }>
                    ${ (dual_active) ? '<div class="lccp_gradient_ranges lccp_opacity_ranges" data-track="opacity" title="'+ options.labels[8] +'"></div><div class="lccp_gradient_bar">' : '' }
                    <div class="lccp_gradient lccp_gradient-bg"></div>
                    <div class="lccp_gradient" style="background: ${ active_gradient }" title="${ (dual_active) ? '' : options.labels[4] }"></div>
                    ${ (dual_active) ? '</div>' : '' }
                        
                    ${ (dual_active) ? '<div class="lccp_gradient_ranges lccp_color_ranges" data-track="color" title="'+ options.labels[4] +'"></div>' : '<div class="lccp_gradient_ranges" data-track="color"></div>' }

                    <div class="pccp_deg_f_wrap" ${ (active_mode == 'radial-gradient') ? 'style="display: none;"' : '' }>
                        <img src="   data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABkAAAAZCAYAAADE6YVjAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAZJJREFUeNqsVetthDAMzp06QEagEv/LBk03oBswAhuQDVAn6AgZgTIBbAAb5DZIE+ScUs42OVRLVvBd7M+v2BeRRxVwEQSttei6LlNV/HB/ymDP8+LZYVxVlev73llrXUrLsqSipgBaz5YyvmcppfPRbRYDYJCNMSzId67xPSulXNu223c4KZDTAFgqMRDNKAXwGuokoAEazwMHBLW6gxTExQm6iqOGAoG66Ctc7BHl2fMHnBT1ECVK4zgKLgqbpIYjm1EX/eIFhSh/eb5lgLyC/jucf1I7z7NY1/Ue8t4LybwfDU1APeAabIZ6urIsg85DhyxM/tN7de5cuSK/rcz84uSnQKhU3Q7kNKUqDtNIJrMmEu4ORMvH6NDUtwhII85TBfXSYBtF54p/tBoGMI6mfCDm1bM0JU4+vD/FDMYc6pMUx11ksIuGAFrAAJYCtctEk5PT6WBPTOCMTKKPDljg4j+AHABEw0PSQBMxC8n3cASSbtLibL8rZvOpxHtztBYuGWAFPK63xOPPzFWw0a8AAwA+dEfwP/CgZgAAAABJRU5ErkJggg==" alt="angle" title="${ options.labels[5] }" />

                        <input type="range" name="deg" value="${ gradient_data.deg }" min="0" max="360" step="1" />
                        <input type="number" name="deg-num" value="${ gradient_data.deg }" min="0" max="360" step="1" />
                    </div>
                    <div class="pccp_circle_f_wrap" ${ (active_mode == 'radial-gradient') ? '' : 'style="display: none;"' }>
                        <img src="    data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAhQAAAIUB4uz/wQAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAEZSURBVEiJzdQxSgRBFATQ52hionsKxcjQTERYUzMv4F28hImsiwcQExFEBfUCggtGXkBccRNR1qBnQHRme9p2wYJigu5f9Wd+zaceXexjgFeM8IADbGGmoS6KJVxiHOENVlLF1/HUQrziEBspnaeIV3zGchuD81+IV7wWmUk3Q7ziZpP4HHYib/eBU9yVYnWYnyQwmNDZI1YjDUTx0iD+Xop30BdSk5Kww7LWqOHSSdlAP0H4O3uEP7TucK80SOn8R4wLIWZ1eCufC03ftgUWCxxlCERR4Ay30zQYY1dI01QM4B7bwkCnYgAXWMPVXxo0LalNzArzaVoPWQZfkWVQxK/k4V8Y5MR32MbgOMOgVW1H2Iqp67qHzif097OAt54XXQAAAABJRU5ErkJggg==" alt="shape" title="${ options.labels[6] }" />

                        <span class="pcpp_ellipse_shape ${ (gradient_data.radial_circle) ? '' :  'pcpp_circle_btn_active' }" data-val="ellipse">Ellipse</span>
                        <span class="pcpp_circle_shape ${ (gradient_data.radial_circle) ? 'pcpp_circle_btn_active' : '' }" data-val="circle">Circle</span>
                    </div>
                    <hr/>
                </div>`;
            }

            
            // selected stop position (dual tracks only)
            if(dual_active) {
                picker += `
            <div class="pccp_pos_f_wrap" style="display: none;">
                <span>${ options.labels[9] }</span>
                <input type="number" name="stop-pos" value="0" min="0" max="100" step="1" />
                <span>%</span>
            </div>`;
            }
            
            // HTML5 colorpicker
            picker += `
            <div class="pccp_color_f_wrap" ${ (graduated) ? 'style="display: none;"' : (!print_grad_code) ? 'style="margin-top: 0;"' : '' }>
                <img src="  data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAA2wAAANsB8FDmnAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAFzSURBVEiJrdU/SxxRFIbx3wgWCjbRSkEICCHBzhCwUCurQDr3I6QLaJEqTcDWJoVNPoAWqW2sXAJW22hhkX+F1VYKBlwQ15ti7+Cy2Z29M+OFt5i5nOdhztw5I4QgNXiFH/iYXFMCPoFThJhPTy340AcPeEDjSQRYxN8BQcAt3tQSYBInQ+B52pitI/haAM/zpZIAOwnwgDsslRLgLbqJgoBvyQIs46YEPM/qWAGm8asCPOB7imCvIjzPy5ECrOC+pmC3SJByJMflvEhwUQO8j0t0kP0nwDO9+VIFfh8Px0m8nh8mmKrR/zO9aXsTGVM5d0JcIYRObFGV1cQLzOAisojW/tWqAG/jM94PZQy85IZyrenqjZR1j2OlMfIURclRIvwP1jCH3/HeUcqXvIDrEdCfOMC2Xr/fxRaFWLOQOuw2+wrzHMe959iKonyvjc2y43oWhwOSqyFPdajgj5ZF2MiVZdkGNvA6Jj8pLTRDCM2i+n/jlZhJOn4yuAAAAABJRU5ErkJggg==" alt="color" title="${ options.labels[7] }" />

                <div>
                    <input type="color" name="color" value="${ shown_solid }" style="opacity: ${ active_opacity };" />
                </div>
                <input type="text" name="hex" value="${ shown_solid.toLowerCase() }" />
            </div>`;
            
            // opacity cursor
            if(options.transparency) {
                picker += `
                <div class="pccp_opacity_f_wrap" ${ (graduated) ? 'style="display: none;"' : '' }>
                    <img src=" data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAApgAAAKYB3X3/OAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAF9SURBVEiJtda/ihRBEMfxT42D4Jmdq5GHIBqJIHgYGCuIIhcYaGRgYGDsU4i+gqFgJogXivgGwkUmKpqcnhgJJ/4pg5mV3XVmd3q5K+iku+v37e7qrurITH0WEUdwC5dwCiexi21sZub9XufW6h7ho3iEmzg4M/wOm3i/SBxk5lTDDXxB9rRnHT7H8QYX/hubmXgHf+aI9wEO4CW+Yb0T0B7HIvFOQOu/glct5PwUAMfwdYB4L6DVOYzX+DTuGwf5IVYHBW2OZeb3iLiC9cn+EX4OXP3cHXS1qj37zuu6F1bjaqFP/8ucsIi4jtM1ThQCYuC8azhXYa0QUGTVfoqPAR/3E1DjA84U+AwKMl7gba3JjCU3aVCQM/M5zRE9xa8CQJFVmbmDJ3slGBGHIuLiv442SY3MrwFLJ7uqhezgriZdL7vyFU1gz2JjagcTK7iN36U7MKTgzJTMz4WANWxZVDInHEZ4jB8dgC08wL0h6ToWfFtWNd+Wy5b8tvwFZS60TLZpD/8AAAAASUVORK5CYII=" alt="opacity" title="${ options.labels[8] }" />
                    
                    <input type="range" name="opacity" value="${ shown_opacity }" min="0" max="1" step="0.01" />
                    <input type="number" name="opacity-num" value="${ shown_opacity }" min="0" max="1" step="0.05" />
                </div>`;
            }
            
            
            // append or re-fill
            (on_manual_input_change && document.getElementById("lc-color-picker")) ? picker_el.innerHTML = picker : document.body.insertAdjacentHTML('beforeend', picker +'</div>');
            
            
            // modes change
            if(options.modes.length > 1) {
                for (const mode of document.querySelectorAll('#lccp_modes_wrap span')) {
                    mode.addEventListener("click", (e) => { $this.mode_change( e.target, e.target.getAttribute('data-mode')) });
                } 
            }
            
            // print steps and add gradient step action
            if(print_grad_code) {
                $this.redraw_gradient_steps();
                
                // the stop rows are drag surfaces, not text: a press inside them must never
                // start a native text selection or a native image drag (the latter swallows
                // mouseup, leaving the stop stuck in mid-drag)
                document.querySelectorAll('.lccp_gradient_ranges').forEach((row) => {
                    row.addEventListener("mousedown", (e) => { e.preventDefault(); });
                });
                
                // every fresh press starts a new gesture: a drag ends with the click that
                // follows mouseup, nothing else may consume it
                document.getElementById('lc-color-picker').addEventListener("mousedown", () => { drag_moved = false; });
                
                if(dual_active) {
                    // only the stop rows add stops; the preview bar itself does nothing
                    document.querySelectorAll('.lccp_dual_tracks .lccp_gradient_ranges').forEach((row) => {
                        row.addEventListener("click", (e) => {
                            if(e.target.closest('.lccp_gradient_range')) { return; }
                            $this.add_gradient_step(e, row.getAttribute('data-track'));
                        });
                    });
                    $this.sync_dual_fields();
                }
                else {
                    document.querySelector('.lccp_gradient:not(.lccp_gradient-bg)').addEventListener("click", (e) => {$this.add_gradient_step(e, 'color') });
                }
            }
            
            // angle actions
            if(options.modes.indexOf('linear-gradient') !== -1) {
                document.querySelector('.pccp_deg_f_wrap input[type=range]').addEventListener("input", (e) => {this.track_deg_range_change(e)});
                document.querySelector('.pccp_deg_f_wrap input[name=deg-num]').addEventListener("change", (e) => {this.track_deg_num_change(e)});
                document.querySelector('.pccp_deg_f_wrap input[name=deg-num]').addEventListener("keyup", (e) => {
                    this.debounce('deg_f_change', 500, 'track_deg_num_change', e); 
                });
            }
            
            // circle actions
            if(options.modes.indexOf('radial-gradient') !== -1) {
                for (const mode of document.querySelectorAll('.pccp_circle_f_wrap span')) {
                    mode.addEventListener("click", (e) => { $this.set_ellipse_circle( e.target, e.target.getAttribute('data-val')) });
                } 
            }
            
            // selected stop position
            if(dual_active) {
                const pos_f = document.querySelector('.pccp_pos_f_wrap input[name=stop-pos]');
                pos_f.addEventListener("change", (e) => {this.track_stop_pos_change(e)});
                pos_f.addEventListener("keyup", (e) => {
                    this.debounce('stop_pos_f_change', 500, 'track_stop_pos_change', e);
                });
            }
            
            // color actions
            document.querySelector('.pccp_color_f_wrap input[type="color"]').addEventListener("input", (e) => {this.track_color_change(e)});
            document.querySelector('.pccp_color_f_wrap input[type="color"]').addEventListener("change", (e) => {this.track_color_change(e)});
            document.querySelector('.pccp_color_f_wrap input[name=hex]').addEventListener("keyup", (e) => {
                this.debounce('hex_f_change', 600, 'track_color_hex_change', e); 
            });
            
            // transparency actions
            if(options.transparency) {
                document.querySelector('.pccp_opacity_f_wrap input[type=range]').addEventListener("input", (e) => {this.track_opacity_range_change(e)});
                document.querySelector('.pccp_opacity_f_wrap input[name=opacity-num]').addEventListener("change", (e) => {this.track_opacity_num_change(e)});
                document.querySelector('.pccp_opacity_f_wrap input[name=opacity-num]').addEventListener("keyup", (e) => {
                    this.debounce('opacity_f_change', 500, 'track_opacity_num_change', e); 
                });
            }
        };
        
        
        
        /*** add draggable element ***/
        this.add_draggable_element = function(track, rel_step_num, position, color) {
            const $this = this,
                  container = document.querySelector('.lccp_gradient_ranges[data-track="'+ track +'"]'),
                  steps = (dual_active) ? gradient_data[track +'_steps'] : gradient_data.steps,
                  min_steps = (dual_active) ? 1 : 2,
                  del_btn_vis = (steps.length > min_steps) ? '' : 'style="display: none;"';
            
            if(!container) { return false; }
            
            const el = document.createElement('span');
            el.className = 'lccp_gradient_range'+ ((!dual_active && !rel_step_num) ? ' lccp_sel_step' : '');
            el.setAttribute('data-step-num', rel_step_num);
            el.setAttribute('data-track', track);
            el.setAttribute('tabindex', '-1');
            el.style.background = color;
            el.style.left = position +'%';
            el.innerHTML = '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAJFJREFUeNpiYMAOFIC4H4jPA/F/NHweKqfAQAQQgCr+TyTuJ2TYeRIMQ3axADYD8RlWAMVEG9pAwBUwQJT3FYjwFjEGgrACE5BIYKAeyGcgMiKIdeF9RjQNuAAjkoEEAXpskgpQYp+JgcqA6l4GufACFR34AGTgRioauIHqCZsmWY8mhQNNii+qF7BUqQIAAgwANgu7Y7cw5VAAAAAASUVORK5CYII=" '+ del_btn_vis +' />';
            container.appendChild(el);
            
            // start dragging this stop (document-level listeners are bound once, at the top of this file)
            const start_drag = function(e) {
                const start_x = (e.type === 'touchstart') ? ((e.touches[0]) ? e.touches[0].clientX : null) : e.clientX;
                if(start_x === null || typeof(start_x) == 'undefined') { return false; }
                
                // the stop being pressed becomes the selected one straight away: the editors
                // follow the pointer while dragging, exactly as a click would leave them
                if(sel_track !== track || sel_grad_step !== rel_step_num) {
                    $this.select_gradient_step(track, rel_step_num);
                }
                if(document.activeElement !== el) {
                    el.focus({preventScroll: true});
                }
                
                // a press only turns into a drag once it travels past the deadzone: a click
                // always wobbles a couple of px, which used to move the stop by +-1%
                const start_pos = parseInt(steps[rel_step_num].position, 10) || 0;
                drag_moved = false;
                
                drag_state = {
                    onMove: function(ev) {
                        ev.preventDefault();
                        const clientX = (ev.type === 'touchmove') ? ((ev.touches[0]) ? ev.touches[0].clientX : null) : ev.clientX;
                        if(clientX === null || typeof(clientX) == 'undefined') { return; }
                        
                        const delta_x = clientX - start_x;
                        if(!drag_moved && Math.abs(delta_x) < drag_deadzone) { return; }
                        drag_moved = true;
                        
                        // the element may have been re-created by a redraw while pressed
                        // (checked through parentNode - isConnected is missing in EdgeHTML)
                        if(!el.parentNode) { return; }
                        
                        let new_pos = Math.round(start_pos + (100 * delta_x) / (container.offsetWidth || 1));
                        
                        // keep one free slot from the neighbours: no duplicated positions, no crossing
                        const min_pos = (!rel_step_num) ? 0 : parseInt(steps[rel_step_num - 1].position, 10) + 1;
                        const max_pos = (rel_step_num == (steps.length - 1)) ? 100 : parseInt(steps[rel_step_num + 1].position, 10) - 1;
                        
                        if(new_pos < min_pos) { new_pos = min_pos; }
                        if(new_pos > max_pos) { new_pos = max_pos; }
                        new_pos = Math.max(0, Math.min(100, new_pos));
                        
                        if(new_pos === steps[rel_step_num].position) { return; }
                        steps[rel_step_num].position = new_pos;
                        el.style.left = new_pos +'%'; 
                        $this.apply_gradient_changes();
                    },
                    onEnd: function() { 
                        if(!drag_moved) { return; }
                        $this.apply_changes(); 
                    }
                };
            };
            
            el.addEventListener('mousedown', start_drag);
            el.addEventListener('touchstart', start_drag);
            
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                $this.select_gradient_step(track, rel_step_num);
            });
            
            el.querySelector('img').addEventListener('click', (e) => {
                e.stopPropagation();
                if(steps.length <= min_steps) { return false; }
                
                // a press that turned into a drag is not a click on the delete button
                if(drag_moved) { return false; }
                
                // wait a bit to not interfere with the global handler for picker closing
                setTimeout(() => {
                    const to_select = (!rel_step_num) ? 0 : rel_step_num - 1;
                    steps.splice(rel_step_num, 1);
                    
                    $this.redraw_gradient_steps();
                    const new_el = container.querySelector('.lccp_gradient_range[data-step-num="'+ to_select +'"]');
                    if(new_el) { new_el.click(); }
                    $this.apply_gradient_changes(true);
                }, 20);
            });
        };
        
        
        
        /* rebuild the stop rows from gradient_data */
        this.redraw_gradient_steps = function() {
            const $this = this;
            document.querySelectorAll('.lccp_gradient_range').forEach(r => r.remove());
            
            if(dual_active) {
                gradient_data.opacity_steps.some(function(step, index) {
                    $this.add_draggable_element('opacity', index, step.position, '#cccccc');
                });
                gradient_data.color_steps.some(function(step, index) {
                    $this.add_draggable_element('color', index, step.position, step.color);
                });
            }
            else {
                gradient_data.steps.some(function(step, index) {
                    $this.add_draggable_element('color', index, step.position, step.color);
                });
            }
        };
        
        
        
        /* select a gradient stop and sync the editor fields */
        this.select_gradient_step = function(track, step_num) {
            sel_track = track;
            sel_grad_step = step_num;
            
            document.querySelectorAll('.lccp_gradient_range').forEach(m => m.classList.remove('lccp_sel_step'));
            const el = document.querySelector('.lccp_gradient_range[data-track="'+ track +'"][data-step-num="'+ step_num +'"]');
            if(el) { el.classList.add('lccp_sel_step'); }
            
            const color_input = document.querySelector('#lc-color-picker input[type="color"]');
            
            if(dual_active) {
                const steps = (track == 'opacity') ? gradient_data.opacity_steps : gradient_data.color_steps;
                if(!steps[step_num]) { return false; }
                
                if(track == 'color') {
                    active_solid = steps[step_num].color;
                    
                    // a color stop is always fully opaque: alpha belongs to the opacity track
                    if(color_input) { 
                        color_input.value = active_solid; 
                        color_input.style.opacity = 1;
                    }
                    document.querySelector('.pccp_color_f_wrap input[name=hex]').value = active_solid;
                }
                else {
                    active_opacity = steps[step_num].opacity;
                    if(options.transparency) {
                        document.querySelector('.pccp_opacity_f_wrap input[type=range]').value = active_opacity; 
                        document.querySelector('.pccp_opacity_f_wrap input[name=opacity-num]').value = active_opacity; 
                        if(color_input) { color_input.style.opacity = active_opacity; }
                    }
                }
                this.sync_dual_fields();
                return true;
            }
            
            // single-track: original behaviour
            active_solid = gradient_data.steps[ step_num ].color;
            active_opacity = gradient_data.steps[ step_num ].opacity;
            
            if(color_input) { color_input.value = active_solid; }
            document.querySelector('.pccp_color_f_wrap input[name=hex]').value = active_solid;
                
            if(options.transparency) {
                document.querySelector('.pccp_opacity_f_wrap input[type=range]').value = active_opacity; 
                document.querySelector('.pccp_opacity_f_wrap input[name=opacity-num]').value = active_opacity; 
            }
        };
        
        
        
        /* kept for backwards compatibility */
        this.select_gradient_color = function(step_num) {
            return this.select_gradient_step('color', step_num);
        };
        
        
        
        /* precisely position the selected gradient stop */
        this.track_stop_pos_change = function(e) {
            if(!dual_active || !sel_track || active_mode == 'solid') { return false; }
            
            const steps = (sel_track == 'opacity') ? gradient_data.opacity_steps : gradient_data.color_steps,
                  step = steps[sel_grad_step];
            if(!step) { return false; }
            
            let pos = parseInt(e.target.value, 10);
            if(isNaN(pos)) { pos = step.position; }
            pos = Math.max(0, Math.min(100, pos));
            
            // nearest free slot in the same track (the other track may use the same position)
            const taken = steps.map((s, i) => (i == sel_grad_step) ? -1 : parseInt(s.position, 10));
            pos = _free_position(taken, pos);
            
            e.target.value = pos;
            if(pos == step.position) { return false; }
            
            step.position = pos;
            steps.sort((a, b) => a.position - b.position);
            
            // the array index may have changed: keep the selection on the very same stop
            const new_index = steps.indexOf(step);
            sel_grad_step = new_index;
            this.redraw_gradient_steps();
            
            const el = document.querySelector('.lccp_gradient_range[data-track="'+ sel_track +'"][data-step-num="'+ new_index +'"]');
            if(el) { el.classList.add('lccp_sel_step'); }
            
            this.sync_dual_fields();
            this.apply_gradient_changes(true);
            return true;
        };
        
        
        
        /* show/hide the color and opacity editors according to the selected stop */
        this.sync_dual_fields = function() {
            if(!dual_active) { return; }
            const picker = document.getElementById('lc-color-picker');
            if(!picker) { return; }
            
            const color_wrap = picker.querySelector('.pccp_color_f_wrap'),
                  opacity_wrap = picker.querySelector('.pccp_opacity_f_wrap'),
                  pos_wrap = picker.querySelector('.pccp_pos_f_wrap'),
                  grad_mode = (active_mode != 'solid'),
                  // a panel anchored upwards grows towards the top: hiding a row would move
                  // every stop under the pointer, so the rows keep their space and are disabled
                  keep_space = picker.classList.contains('lccp_up');
            
            const set_row = function(wrap, usable) {
                if(!wrap) { return; }
                
                wrap.style.display = (keep_space || usable) ? 'flex' : 'none';
                wrap.classList.toggle('pccp_row_off', keep_space && !usable);
                
                wrap.querySelectorAll('input').forEach((field) => {
                    field.disabled = (keep_space && !usable);
                });
            };
            
            set_row(color_wrap, !grad_mode || sel_track == 'color');
            set_row(opacity_wrap, !grad_mode || sel_track == 'opacity');
            set_row(pos_wrap, !!(grad_mode && sel_track));
            
            if(pos_wrap) {
                const pos_f = pos_wrap.querySelector('input');
                if(pos_f && grad_mode && sel_track) {
                    const steps = (sel_track == 'opacity') ? gradient_data.opacity_steps : gradient_data.color_steps;
                    if(steps[sel_grad_step]) { pos_f.value = steps[sel_grad_step].position; }
                }
            }
            
            // no stop selected means every editor below the wizard is hidden: drop its trailing
            // divider too - unless the rows are kept in place, where it has to hold its space
            const divider = picker.querySelector('.lccp_gradient_wizard hr');
            if(divider) {
                divider.style.display = (!keep_space && grad_mode && !sel_track) ? 'none' : '';
            }
        };
        
        
        
        /* apply changes to gradient, after a color/opacity/degree update */
        this.apply_gradient_changes = function(also_apply_changes) {
            const $this = this;
            
            // dual tracks: merge both stop rows into one standard CSS gradient
            if(dual_active) {
                const grad_mode = (active_mode == 'solid') ? 'linear-gradient' : active_mode;
                active_gradient = build_gradient_css(
                    grad_mode, gradient_data.deg, gradient_data.radial_circle,
                    gradient_data.color_steps, gradient_data.opacity_steps, options.transparency,
                    interp_mode, options.interpolation_step
                );
                
                const bar = document.querySelector('.lccp_gradient:not(.lccp_gradient-bg)');
                if(bar) { bar.style.background = active_gradient; }
                
                if(also_apply_changes) { this.apply_changes(); }
                return true;
            }
            
            // plug-in interpolation: sample the color track in OKLCH (opacity stays linear)
            if(interp_resample) {
                active_gradient = build_gradient_css(
                    active_mode, gradient_data.deg, gradient_data.radial_circle,
                    gradient_data.steps, gradient_data.steps, options.transparency,
                    interp_mode, options.interpolation_step
                );
                
                if(document.querySelector('.lccp_gradient:not(.lccp_gradient-bg)')) {
                    document.querySelector('.lccp_gradient:not(.lccp_gradient-bg)').style.background = active_gradient;
                }
                if(also_apply_changes) { this.apply_changes(); }
                return true;
            }
            
            let new_gradient = active_mode+'('+ ((interp_mode == 'oklch-css') ? 'in oklch ' : '');
            new_gradient += (active_mode == 'linear-gradient') ? gradient_data.deg+'deg' : (gradient_data.radial_circle) ? 'circle' : 'ellipse';
            new_gradient += ', ';
            
            let colors_part = []
            gradient_data.steps.some(function(step, index) {
                
                let to_add = (options.transparency) ? $this.hex_to_RGBA(step.color, step.opacity) : $this.shorten_hex(step.color);
                
                if(
                    gradient_data.steps.length > 2 ||
                    (
                        gradient_data.steps.length <= 2 && 
                        (
                            (!index && parseInt(step.position, 10)) || 
                            (index && index < (gradient_data.steps.length - 1)) || 
                            (index == (gradient_data.steps.length - 1) && parseInt(step.position, 10) != 100)
                        )
                    )
                ) {
                        to_add += ' '+ step.position +'%';
                    }
                
                colors_part.push( to_add );    
            });
            
            active_gradient = new_gradient + colors_part.join(', ') + ')';
            
            if(document.querySelector('.lccp_gradient:not(.lccp_gradient-bg)')) {
                document.querySelector('.lccp_gradient:not(.lccp_gradient-bg)').style.background = active_gradient;
            }
            
            if(also_apply_changes) {
                this.apply_changes();    
            }
        };
        
        
        
        /* convert hex + opacity to the 8-digit #RRGGBBAA form */
        this.hex_to_hex8 = function(h, opacity) {
            const fixed = this.short_hex_fix(h);
            
            // not a hex color (named colors and the like): keep the original notation
            if(!/^#[0-9a-f]{6}$/.test(fixed)) {
                return _shorten_hex(h);
            }
            
            const rgb = fixed.replace('#', '');
            let a = Math.round(parseFloat(opacity) * 255);
            if(isNaN(a)) { a = 255; }
            a = Math.max(0, Math.min(255, a));
            let s = a.toString(16);
            if(s.length == 1) { s = '0'+ s; }
            return '#'+ rgb + s;
        };
        
        
        
        /* apply changes to target field */
        this.apply_changes = function() {
            if(!active_trigger) {
                return false;    
            }
            let val = '';
            
            // apply everything to picker global vars
            if(active_mode == 'solid') {
                val = this.shorten_hex(active_solid);
                
                if(options.transparency && document.querySelector('.pccp_opacity_f_wrap input[type=range]')) {
                    active_opacity = document.querySelector('.pccp_opacity_f_wrap input[type=range]').value; 
                    val = (options.solid_hex8) ? this.hex_to_hex8(val, active_opacity) : this.hex_to_RGBA(val, active_opacity);
                }
            }
            else {
                val = active_gradient;
            }
            
            // apply
            active_trigger.style.background = val;
            
            const field = active_trigger.parentNode.querySelector(right_input_selector),
                  value_changed = (field.value != val);
            
            field.value = val;
            
            // write the lossless structure first: a synchronous input/change listener may read it right away
            let meta_changed = false;
            if(active_mode != 'solid') {
                if(dual_active) {
                    meta_changed = this.save_dual_data(val);
                }
                else if(single_lossless) {
                    meta_changed = this.save_single_data(val);
                }
            }
            
            // notify when the value or the underlying tracks moved
            if(value_changed || meta_changed) {
                last_tracked_col = val;
                fire_field_events(field);
                
                if(typeof(options.on_change) == 'function') {

                    if(typeof(debounced_vars['on_change_cb']) != undefined && debounced_vars['on_change_cb']) {
                        clearTimeout(debounced_vars['on_change_cb']);    
                    }
                    debounced_vars['on_change_cb'] = setTimeout(() => {
                        options.on_change.call(this, val, field);                                               
                    }, 300);  
                }
            }

        };
        
        
        

        
        
        // HANDLERS
        
        // fields toggle basing on modes change
        this.mode_change = function(el, new_mode) {
            if(active_mode == new_mode) {
                return false;    
            }
            let color, opacity;
            
            // from gradient to solid 
            if(new_mode == 'solid') {
                color = active_solid;
                if(options.transparency) {
                    opacity = active_opacity;
                }    
            }
            else {
                color = (dual_active) ? gradient_data.color_steps[0].color : gradient_data.steps[0].color;
                if(options.transparency) {
                    opacity = (dual_active) ? gradient_data.opacity_steps[0].opacity : gradient_data.steps[0].opacity;
                }
            }
            
            document.querySelector('#lc-color-picker input[type="color"]').value = color; 
            document.querySelector('.pccp_color_f_wrap input[name=hex]').value = color;
                
            if(options.transparency) {
                document.querySelector('.pccp_opacity_f_wrap input[type=range]').value = opacity; 
                document.querySelector('.pccp_opacity_f_wrap input[name=opacity-num]').value = opacity; 
            }
            
            // toggle grad fields
            if(options.modes.length > 1) {
                document.querySelector('.pccp_deg_f_wrap').style.display = (new_mode == 'linear-gradient') ? 'flex' : 'none';
                document.querySelector('.pccp_circle_f_wrap').style.display = (new_mode == 'radial-gradient') ? 'block' : 'none';
            } 
            
            // toogle gradient wizard
            if(options.modes.indexOf('linear-gradient') !== -1 || options.modes.indexOf('radial-gradient') !== -1) {
                document.querySelector('.lccp_gradient_wizard').style.display = (new_mode != 'solid') ? 'block' : 'none';
            }
            
            document.querySelectorAll('#lccp_modes_wrap span').forEach(m => m.classList.remove('lccp_sel_mode'));
            el.classList.add('lccp_sel_mode');
            
            active_mode = new_mode;
            if(dual_active) {
                sel_track = null;
                this.sync_dual_fields();
            }
            (new_mode == 'solid') ? this.apply_changes() : this.apply_gradient_changes(true);
        };
        
        
        // add gradient step
        this.add_gradient_step = function(e, track) {    
            // the click closing a drag must not add a stop (the pointer may end up anywhere)
            if(drag_moved) { return false; }
            
            const $this = this,
                  steps = (dual_active) ? gradient_data[track +'_steps'] : gradient_data.steps,
                  target = (dual_active) ? document.querySelector('.lccp_gradient_ranges[data-track="'+ track +'"]') : e.currentTarget,
                  raw_pos = (dual_active) ? 
                        Math.round((100 * (e.clientX - target.getBoundingClientRect().left)) / (target.offsetWidth || 1)) : 
                        Math.round((100 * e.layerX) / (e.target.offsetWidth || 1));
            
            // never stack two stops on the same position - hard edges are only set through the API
            const pos = _free_position(steps.map((s) => parseInt(s.position, 10)), Math.max(0, Math.min(100, raw_pos)));
            
            // inject in the right place
            let index = steps.length;
            for(let i = 0; i < steps.length; i++) {
                if(steps[i].position > pos) { index = i; break; }
            }
            
            const prev = (index > 0) ? steps[index - 1] : steps[0];
            let step_data;
            if(dual_active && track == 'opacity') {
                step_data = { opacity: prev.opacity, position: pos };
            }
            else if(dual_active) {
                step_data = { color: prev.color, position: pos };
            }
            else {
                step_data = { color: prev.color, opacity: 1, position: pos };
            }
            steps.splice(index, 0, step_data);
            
            $this.redraw_gradient_steps();
            
            // select newly added element
            const new_el = document.querySelector('.lccp_gradient_range[data-track="'+ track +'"][data-step-num="'+ index +'"]');
            if(new_el) { new_el.click(); }
            
            this.apply_gradient_changes(true);
        };
        
        
        // apply ellipse or circle
        this.set_ellipse_circle = function(el, new_opt) {
            if(gradient_data.radial_circle && new_opt == 'circle' || !gradient_data.radial_circle && new_opt != 'circle') {
                return false;    
            }
            gradient_data.radial_circle = !gradient_data.radial_circle;

            document.querySelectorAll('.pccp_circle_f_wrap span').forEach(m => m.classList.remove('pcpp_circle_btn_active'));
            el.classList.add('pcpp_circle_btn_active');
            
            this.apply_gradient_changes(true);
        };
        
        
        // track opacity range fields change
        this.track_deg_range_change = function(e) {
            document.querySelector('.pccp_deg_f_wrap input[name=deg-num]').value = e.target.value;
            
            gradient_data.deg = e.target.value;
            this.apply_gradient_changes(true);
        };
        this.track_deg_num_change = function(e) {
            let val = parseFloat(e.target.value);
            if(isNaN(val) || val < 0 || val > 360) {
                val = 90;   
            }
            
            e.target.value = val;
            if(document.querySelector('.pccp_deg_f_wrap input[type=range]')) {
                document.querySelector('.pccp_deg_f_wrap input[type=range]').value = val;
            }
            
            gradient_data.deg = val;
            this.apply_gradient_changes(true);
        };
        
        
        // track opacity range fields change
        this.track_color_change = function(e) {
            const val = e.target.value.toLowerCase();
            document.querySelector('.pccp_color_f_wrap input[name=hex]').value = val;
            
            this.apply_color_change(val);
        };
        this.track_color_hex_change = function(e) {
            let val = this.short_hex_fix(e.target.value);

            if(val.match(/^#[a-f0-9]{6}$/i) === null) {
                val = active_solid.toLowerCase();     
            }
            
            e.target.value = val;
            document.querySelector('#lc-color-picker input[type="color"]').value = val;
            
            this.apply_color_change(val);
        };
        this.apply_color_change = function(val) {
            if(active_mode == 'solid') {
                active_solid = val;
                this.apply_changes();        
                return true;
            }
            
            if(dual_active) {
                // only a selected color stop can be edited
                if(sel_track != 'color' || !gradient_data.color_steps[sel_grad_step]) { return false; }
                gradient_data.color_steps[ sel_grad_step ].color = val;
            }
            else {
                if(!gradient_data.steps[sel_grad_step]) { return false; }
                gradient_data.steps[ sel_grad_step ].color = val;
            }
            
            const sel = document.querySelector('.lccp_sel_step');
            if(sel) { sel.style.background = val; }
            this.apply_gradient_changes(true);
            return true;
        };
        
        
        // track opacity range fields change
        this.track_opacity_range_change = function(e) {
            document.querySelector('.pccp_opacity_f_wrap input[name=opacity-num]').value = e.target.value;
            this.alter_hex_opacity(e.target.value);
        };
        this.track_opacity_num_change = function(e) {
            let val = parseFloat(e.target.value);
            if(isNaN(val) || val < 0 || val > 1) {
                val = 0.5;   
            }
            
            e.target.value = val;
            
            if(document.querySelector('.pccp_opacity_f_wrap input[type=range]')) {
                document.querySelector('.pccp_opacity_f_wrap input[type=range]').value = val;
                this.alter_hex_opacity(val);
            }
        };
        this.alter_hex_opacity = function(opacity) {
            const color_input = document.querySelector('#lc-color-picker input[type="color"]');
            if(color_input) { color_input.style.opacity = opacity; }
            
            if(active_mode == 'solid') {
                active_opacity = opacity;
                this.apply_changes();        
                return true;
            }
            
            if(dual_active) {
                // only a selected opacity stop can be edited
                if(sel_track != 'opacity' || !gradient_data.opacity_steps[sel_grad_step]) { return false; }
                gradient_data.opacity_steps[ sel_grad_step ].opacity = parseFloat(opacity);
            }
            else {
                if(!gradient_data.steps[sel_grad_step]) { return false; }
                gradient_data.steps[ sel_grad_step ].opacity = opacity;
            }
            this.apply_gradient_changes(true);
            return true;
        };
        
        
        
        
        
        /* 
         * UTILITY FUNCTION - debounce action to run once after X time 
         *
         * @param (string) action_name
         * @param (int) timing - milliseconds to debounce
         * @param (string) - class method name to call after debouncing
         * @param (mixed) - extra parameters to pass to callback function
         */
        this.debounce = function(action_name, timing, cb_function, cb_params) {
            if( typeof(debounced_vars[ action_name ]) != 'undefined' && debounced_vars[ action_name ]) {
                clearTimeout(debounced_vars[ action_name ]);    
            }
            const $this = this;
            
            debounced_vars[ action_name ] = setTimeout(() => {
                $this[cb_function].call($this, cb_params);    
            }, timing); 
        };
        
        
        
        
        
        /* CSS - creates inline CSS into the page */
        this.generate_style = function() {       
            const transp_bg_img = "url('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAQDAwMDAwQDAwQGBAMEBgcFBAQFBwgGBgcGBggKCAkJCQkICgoMDAwMDAoMDA0NDAwRERERERQUFBQUFBQUFBT/2wBDAQQFBQgHCA8KCg8UDg4OFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAoACgDAREAAhEBAxEB/8QAFwABAQEBAAAAAAAAAAAAAAAAAAUGCP/EACIQAQAABQMFAQAAAAAAAAAAAAAFFUNjgqLB4RESEzVRkf/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwDv4AE6K0stgTgAaIAE6K0stgTgAUZra1cATW1q4A9na8WXXu/PgEqu6eQJVd08gnAAowqrjuCiADOgAowqrjuCiAD/2Q==')";
            
            document.head.insertAdjacentHTML('beforeend', 
`<style>
.lccp-el-wrap {
    position: relative;
    display: inline-block;
}
.lccp-el-wrap > input {
    margin: 0;
    min-width: 100%;
    max-width: 100%;
    width: auto;
}
.lccp-preview,
.lccp-preview-bg {
    display: inline-block;
    position: absolute;
    cursor: pointer;
    z-index: 15;
}
.lccp-preview-bg {
    z-index: 10;
}
.lccp-preview-right .lccp-preview { 
    border-left: 1px solid #ccc;
}
.lccp-preview:focus {
    outline: 2px solid #4a90e2;
    outline-offset: 2px;
}
.lccp-preview-left .lccp-preview { 
    border-right: 1px solid #ccc;
}
.lccp-direct-cp-f {
    padding: 0 !important;
    margin: 0 !important;
    width: 0 !important;
    height: 0 !important;
    position: absolute;
    bottom: 0;
    visibility: hidden;
}
.lccp-preview-right .lccp-direct-cp-f { 
    right: 0;
}
.lccp-preview-left .lccp-direct-cp-f{ 
    left: 0;
}
#lc-color-picker,
#lc-color-picker * {
    box-sizing: border-box;
    font-family: sans-serif;
}
#lc-color-picker {
    visibility: hidden;
    z-index: -100;
    opacity: 0;
    position: absolute;
    top: -9999px;
    z-index: 9999999999;
    width: 280px;
    background: #fff;
    box-shadow: 0px 2px 13px -2px rgba(0, 0, 0, .18);
    border-radius: 4px;
    overflow: hidden;
    padding: 10px;
    border: 1px solid #ccc;
    transition: opacity .15s ease;
}
#lc-color-picker.lccp-shown {
    visibility: visible;
    opacity: 1;

}

#lccp_modes_wrap {
	display: flex;
	flex-direction: row;
	justify-content: space-between;
    margin-bottom: 10px;
}
#lccp_modes_wrap span,
.pccp_circle_f_wrap span {
	display: inline-block;
	border: 1px solid #e8e8e8;
	background: #e8e8e8;
    opacity: .78;
	padding: 4px 7px;
	font-size: 11.5px;
	border-radius: 3px;
	line-height: normal;
    cursor: pointer;
    user-select: none; 
    transition: all .2s ease;
}
#lccp_modes_wrap span.lccp_sel_mode,
.pccp_circle_f_wrap span.pcpp_circle_btn_active {
	border: 1px solid #bbb;
	background: #fff;
    opacity: 1;
	cursor: default;
}
.lccp_gradient_wizard,
.lccp_gradient_ranges {
    position: relative;
}
.lccp_gradient {    
    height: 35px;
    border: 1px solid #aaa;
    cursor: crosshair;
    position: relative;
    z-index: 10;
    user-select: none;
}
.lccp_gradient-bg {
	position: absolute;
	top: 0;
	z-index: 0;
	width: 100%;
	margin: 0;
}
.lccp_gradient_ranges {
    margin: 2px 7px 25px 8px;
    height: 20px;
}
.lccp_gradient_bar {
    position: relative;
}
.lccp_dual_tracks .lccp_gradient_ranges {
    height: 18px;
    margin: 0 7px 3px 8px;
    cursor: crosshair;
}
/* opacity stops point upwards: same left anchor as color stops, whole marker (incl. delete button) flipped 180deg */
/* each row reserves space on the side its delete buttons stick out to: 25px below the color row
   (same spacing v2.0.0 used), 20px above the flipped opacity row */
.lccp_dual_tracks .lccp_opacity_ranges {
    margin-top: 20px;
    margin-bottom: 4px;
    height: 20px;
}
.lccp_dual_tracks .lccp_opacity_ranges .lccp_gradient_range {
    top: 6px;
    transform: rotate(45deg) translate3d(-5px, 5px, 0) rotate(180deg);
}
.lccp_dual_tracks .lccp_color_ranges {
    margin-top: 3px;
    margin-bottom: 25px;
}
.lccp_dual_tracks .lccp_gradient_range {
    top: 2px;
}
/* in dual mode only the stop rows add stops: the preview bar is not clickable */
.lccp_dual_tracks .lccp_gradient_bar .lccp_gradient {
    cursor: default;
}
.lccp_gradient_range {
	display: inline-block;
	width: 13px;
	height: 13px;
	border: 1px solid #ccc;
	border-radius: 0 50% 50% 50%;
	transform: rotate(45deg) translate3d(-5px, 5px, 0);
	cursor: col-resize;
	position: absolute;
    top: 3px;
}
/* stops take the focus on press so the editors can follow a drag: no ring for that */
.lccp_gradient_range:focus {
    outline: none;
}
.lccp_gradient_range img {
	width: 13px;
	position: relative;
	top: 11px;
	left: 11px;
	opacity: .3;
	cursor: pointer;
    transition: all .2s ease;
}
.lccp_gradient_range img:hover {
    opacity: .5;
}
.lccp_sel_step {
    border: 1px solid #333;
    box-shadow: 0 0 2px 1px teal;
}
.pccp_deg_f_wrap,
.pccp_circle_f_wrap {
    margin-bottom: 10px;
}
.pccp_circle_f_wrap * {
    float: left;
}
.pccp_circle_f_wrap:after {
    content: "";
    clear: both;
    display: block;
}
.pccp_circle_f_wrap img {
    position: relative;
    top: 4px;
}
.pccp_circle_f_wrap span {
    margin-left: 13px;
}
.pccp_circle_f_wrap span:not(.pcpp_circle_btn_active) {
    cursr: pointer;
}
.pccp_deg_f_wrap,
.pccp_color_f_wrap,
.pccp_opacity_f_wrap {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    clear: both;
}
/* editor row kept in place but not usable (panel anchored upwards, no matching stop) */
.pccp_row_off {
    opacity: .45;
    pointer-events: none;
}
.pccp_deg_f_wrap input,
.pccp_color_f_wrap input,
.pccp_opacity_f_wrap input {
    border: 1px solid #aaa;
    border-radius: 3px;
    padding: 0;
}
.lccp-preview-bg,
.pccp_color_f_wrap div,
.lccp_gradient-bg {  
    background: ${ transp_bg_img } repeat;
    background-size: 15px;
}
#lc-color-picker hr {
	margin: 14px 0 0;
	height: 0;
	border-width: 1px 0;
	border-style: dashed;
	border-color: #e3e3e3;
}
.pccp_color_f_wrap div {    
    width: calc(100% - 25px - 85px);
    height: 25px;
    border: 1px solid #aaa;
    border-radius: 2px;
    overflow: hidden;
}
.pccp_deg_f_wrap img,
.pccp_circle_f_wrap img,
.pccp_color_f_wrap img, 
.pccp_opacity_f_wrap img {
	max-width: 15px;
	opacity: .6;
    cursor: help;
    user-select: none;  
}
.pccp_color_f_wrap input[type=color] {   
    -webkit-appearance: none;
    padding: 0;
    width: 110%;
    height: 110%;
    transform: translate(-5%, -5%);
    cursor: pointer;
    border: none;
}
.pccp_color_f_wrap input:focus {
    outline: none;
}
.pccp_color_f_wrap input::-webkit-color-swatch-wrapper {
    padding: 0;
}
.pccp_color_f_wrap input::-webkit-color-swatch {
    border: none;
}
.pccp_color_f_wrap input[name=hex] { 
    width: 70px;
    height: 25px;
    text-align: center;
}
.pccp_color_f_wrap {
    margin-top: 17px;
}
.pccp_opacity_f_wrap {
    margin-top: 10px;
}
.pccp_pos_f_wrap {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: flex-end;
    margin-top: 12px;
    font-size: 11px;
    color: #888;
    user-select: none;
}
.pccp_pos_f_wrap input {
    width: 53px;
    height: 25px;
    margin: 0 5px;
    padding: 0;
    text-align: center;
    border: 1px solid #aaa;
    border-radius: 3px;
}
.pccp_deg_f_wrap input[type=range],
.pccp_opacity_f_wrap input[type=range] {
    width: calc(100% - 25px - 70px);
    height: 25px;
}
.pccp_deg_f_wrap input[type="number"],
.pccp_opacity_f_wrap input[type="number"] {
	width: 53px;
	height: 25px;
	text-align: center;
}
.pccp_deg_f_wrap input[type=range],
.pccp_opacity_f_wrap input[type=range] {
    -webkit-appearance: none;
    height: 5px;
    background: #d5d5d5;
    outline: none;
    border: none;
}
.pccp_deg_f_wrap input::-webkit-slider-thumb,
.pccp_opacity_f_wrap input::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 17px;
    height: 17px;
    background: #888;
    cursor: pointer;
    border-radius: 50%;
    border: 1px solid #aaa;
    box-shadow: 0 0 0 5px #fff inset, 0 0 2px rgba(0,0,0,.15);
}
.pccp_deg_f_wrap input::-moz-range-thumb,
.pccp_opacity_f_wrap input::-moz-range-thumb {
    width: 15px;
    height: 15px;
    background: #888;
    cursor: pointer;
    border-radius: 50%;
    border: 1px solid #aaa;
    box-shadow: 0 0 0 5px #fff inset, 0 0 2px rgba(0,0,0,.15);
}

#lc-color-picker.lccp_dark_theme {
    background: #333;
    border-color: #505050;
}
.lccp_dark_theme img {
	filter: invert(100%);
    opacity: .85;
}
.lccp_dark_theme .lccp_gradient_range img {
	opacity: .6;
}
.lccp_dark_theme .lccp_gradient_range img:hover {
    opacity: .8;
}
.lccp_dark_theme .lccp_gradient {
    border-color: #626262;
}
.lccp_dark_theme .lccp_sel_step {
	box-shadow: 0 0 2px 1px orange;
}
#lc-color-picker.lccp_dark_theme hr {
	border-color: #727272;
}
.lccp_dark_theme .pccp_deg_f_wrap input, 
.lccp_dark_theme .pccp_color_f_wrap input, 
.lccp_dark_theme .pccp_opacity_f_wrap input,
.lccp_dark_theme .pccp_pos_f_wrap input {
	border-color: #777;
	background: #505050;
	color: #f3f3f3;
}
.lccp_dark_theme input[type=range] {
    background: #808080;
}
</style>`);
        };
        

        // init when called
        this.init();
    };
    
    
    
    
    
    
    // UTILITIES
    
    // sanitize "selector" parameter allowing both strings and DOM objects
    const maybe_querySelectorAll = (selector) => {
             
        if(typeof(selector) != 'string') {
            if(selector instanceof Element) { // JS or jQuery 
                return [selector];
            }
            else {
                let to_return = [];
                
                for(const obj of selector) {
                    if(obj instanceof Element) {
                        to_return.push(obj);    
                    }
                }
                return to_return;
            }
        }
        
        // clean problematic selectors
        (selector.match(/(#[0-9][^\s:,]*)/g) || []).forEach(function(n) {
            selector = selector.replace(n, '[id="' + n.replace("#", "") + '"]');
        });
        
        return document.querySelectorAll(selector);
    };
    
    
    /*** public API: read/write the lossless dual-track gradient structure ***/
    const resolve_field = function(field) {
        const els = maybe_querySelectorAll(field);
        return (els.length) ? els[0] : null;
    };
    
    window.lc_color_picker.get_gradient_data = function(field) {
        const el = resolve_field(field);
        if(!el) { return null; }
        
        if(el.dataset.lccpTracks) {
            try {
                const stored = JSON.parse(el.dataset.lccpTracks);
                if(stored && (stored.css || '').trim().toLowerCase() === el.value.trim().toLowerCase()) {
                    return normalize_dual_data(stored);
                }
            } catch(err) {}
        }
        
        if(el.value.toLowerCase().indexOf('gradient') !== -1) {
            return normalize_dual_data(css_to_dual(el.value));
        }
        return null;
    };
    
    /* opts (optional): {transparency, interpolation, interpolation_step} - defaults keep the previous behaviour */
    window.lc_color_picker.set_gradient_data = function(field, data, opts) {
        const el = resolve_field(field);
        if(!el || !data || typeof(data) != 'object') { return false; }
        
        const meta = field_instances.get(el),
              inst = (meta && meta.options) ? meta.options : {};
        
        // explicit opts win, then the options this field was initialised with, then the generic defaults
        const pick = function(key, def) {
            if(opts && typeof(opts) == 'object' && typeof(opts[key]) != 'undefined') { return opts[key]; }
            if(typeof(inst[key]) != 'undefined') { return inst[key]; }
            return def;
        };
        const o = {
            transparency       : pick('transparency', true),
            interpolation      : pick('interpolation', 'srgb'),
            interpolation_step : pick('interpolation_step', 5)
        };
        
        const norm = normalize_dual_data(data),
              mode = (el.value.toLowerCase().indexOf('radial-gradient') !== -1) ? 'radial-gradient' : 'linear-gradient',
              css = build_gradient_css(mode, norm.deg, norm.radial_circle, norm.color_steps, norm.opacity_steps, o.transparency, o.interpolation, o.interpolation_step);
        
        el.value = css;
        el.dataset.lccpTracks = JSON.stringify(Object.assign({css: css}, norm));
        
        const trigger = el.parentNode.querySelector('.lccp-preview');
        if(trigger) { trigger.style.background = css; }
        
        // keep an already open panel in sync: drop it and let the own instance rebuild it
        if(trigger && trigger === active_trigger && meta && meta.picker) {
            const panel = document.getElementById('lc-color-picker');
            if(panel) {
                panel.remove();
                active_trigger = null;
                active_trig_id = null;
                meta.picker.show_picker(trigger);
            }
        }
        
        fire_field_events(el);
        return true;
    };
    
    
})();