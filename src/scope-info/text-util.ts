import { Position, Range } from 'vscode';

// 'sticky' flag is not yet supported :(
const lineEndingRE = /([^\r\n]*)(\r\n|\r|\n)?/;

export interface RangeDelta {
  start: Position;
  end: Position;
  linesDelta: number;
  endCharactersDelta: number; // delta for positions on the same line as the end position
}

/**
 * @returns the Position (line, column) for the location (character position)
 */
function positionAt(text: string, offset: number): Position {
  if (offset > text.length)
    offset = text.length;

  let line = 0;
  let lastIndex = 0;

  while (true) {
    const match = lineEndingRE.exec(text.substring(lastIndex));

    if (lastIndex + match[1].length >= offset)
      return new Position(line, offset - lastIndex);

    lastIndex += match[0].length;
    ++line;
  }
}

/**
 * @returns the lines and characters represented by the text
 */
export function toRangeDelta(oldRange: Range, text: string): RangeDelta {
  const newEnd = positionAt(text, text.length);
  let charsDelta;

  if (oldRange.start.line === oldRange.end.line)
    charsDelta = newEnd.character - (oldRange.end.character - oldRange.start.character);
  else
    charsDelta = newEnd.character - oldRange.end.character;

  return {
    start: oldRange.start,
    end: oldRange.end,
    linesDelta: newEnd.line - (oldRange.end.line - oldRange.start.line),
    endCharactersDelta: charsDelta
  };
}

export function rangeDeltaNewRange(delta: RangeDelta): Range {
  let x: number;

  if (delta.linesDelta > 0)
    x = delta.endCharactersDelta;
  else if (delta.linesDelta < 0 && delta.start.line === delta.end.line + delta.linesDelta)
    x = delta.end.character + delta.endCharactersDelta + delta.start.character;
  else
    x = delta.end.character + delta.endCharactersDelta;

  return new Range(delta.start, new Position(delta.end.line + delta.linesDelta, x));
}

function positionRangeDeltaTranslate(pos: Position, delta: RangeDelta): Position {
  if (pos.isBefore(delta.end))
    return pos;
  else if (delta.end.line === pos.line) {
    let x = pos.character + delta.endCharactersDelta;

    if (delta.linesDelta > 0)
      x = x - delta.end.character;
    else if (delta.start.line === delta.end.line + delta.linesDelta && delta.linesDelta < 0)
      x = x + delta.start.character;

    return new Position(pos.line + delta.linesDelta, x);
  }
  else
    return new Position(pos.line + delta.linesDelta, pos.character);
}

function positionRangeDeltaTranslateEnd(pos: Position, delta: RangeDelta): Position {
  if (pos.isBeforeOrEqual(delta.end))
    return pos;
  else if (delta.end.line === pos.line) {
    let x = pos.character + delta.endCharactersDelta;

    if (delta.linesDelta > 0)
      x = x - delta.end.character;
    else if (delta.start.line === delta.end.line + delta.linesDelta && delta.linesDelta < 0)
      x = x + delta.start.character;

    return new Position(pos.line + delta.linesDelta, x);
  }
  else
    return new Position(pos.line + delta.linesDelta, pos.character);
}

export function rangeTranslate(range: Range, delta: RangeDelta): Range {
  return new Range(
    positionRangeDeltaTranslate(range.start, delta),
    positionRangeDeltaTranslateEnd(range.end, delta)
  );
}

export function rangeContains(range: Range, pos: Position, exclStart = false, inclEnd = false): boolean {
  return range.start.isBeforeOrEqual(pos)
    && (!exclStart || !range.start.isEqual(pos))
    && ((inclEnd && range.end.isEqual(pos)) || range.end.isAfter(pos));
}

export function maxPosition(x: Position, y: Position): Position {
  if (x.line < y.line)
    return x;
  else if (y.line < x.line)
    return y;
  else if (x.character < y.character)
    return x;
  else
    return y;
}
