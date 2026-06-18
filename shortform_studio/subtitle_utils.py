def _hex_to_ass(color_hex: str) -> str:
    """Convert #RRGGBB hex to ASS &H00BBGGRR& format."""
    h = color_hex.lstrip('#')
    if len(h) == 3:
        h = h[0] * 2 + h[1] * 2 + h[2] * 2
    r, g, b = h[0:2].upper(), h[2:4].upper(), h[4:6].upper()
    return f'&H00{b}{g}{r}&'


def _fmt_ass_time(secs: float) -> str:
    """Format seconds as ASS timestamp H:MM:SS.cc"""
    h  = int(secs // 3600)
    m  = int((secs % 3600) // 60)
    s  = int(secs % 60)
    cs = round((secs - int(secs)) * 100)
    return f'{h}:{m:02d}:{s:02d}.{cs:02d}'


def segments_to_ass(
    segments: list[dict],
    output_path: str,
    canvas_w: int,
    canvas_h: int,
    font: str,
    size: int,
    color_hex: str,
    style: str,    # "shadow" | "box"
    position: int, # 0=top … 100=bottom
) -> None:
    """Write an .ass subtitle file from Whisper segment dicts."""
    primary_color = _hex_to_ass(color_hex)
    margin_v      = int((1 - position / 100) * canvas_h)

    if style == 'box':
        border_style = 3
        outline      = 0
        shadow       = 0
        back_color   = '&H99000000&'
    else:  # shadow
        border_style = 1
        outline      = 0
        shadow       = 2
        back_color   = '&H00000000&'

    style_line = (
        f'Style: Default,{font},{size},'
        f'{primary_color},&H000000FF&,&H00000000&,{back_color},'
        f'1,0,0,0,100,100,0,0,'
        f'{border_style},{outline},{shadow},'
        f'2,20,20,{margin_v},1'
    )

    lines = [
        '[Script Info]',
        f'PlayResX: {canvas_w}',
        f'PlayResY: {canvas_h}',
        'ScriptType: v4.00+',
        'Collisions: Normal',
        '',
        '[V4+ Styles]',
        'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, '
        'Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, '
        'Alignment, MarginL, MarginR, MarginV, Encoding',
        style_line,
        '',
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ]

    for seg in segments:
        start = _fmt_ass_time(float(seg['start']))
        end   = _fmt_ass_time(float(seg['end']))
        text  = str(seg['text']).replace('\n', ' ').strip()
        if text:
            lines.append(f'Dialogue: 0,{start},{end},Default,,0,0,0,,{text}')

    with open(output_path, 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(lines) + '\n')
