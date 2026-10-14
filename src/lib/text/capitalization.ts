/** Capitalize the first letter only; keep whitespace, punctuation and later casing. */
export function capitalizeInitial(value: string): string {
  return value.replace(/\p{L}/u, letter => letter.toUpperCase());
}

/** Keep the caret in place when Unicode uppercasing changes a letter's length. */
export function capitalizedSelection(value: string, position: number): number {
  const letter = /\p{L}/u.exec(value);
  if (!letter || position <= letter.index) return position;
  const end = letter.index + letter[0].length;
  const capitalEnd = letter.index + letter[0].toUpperCase().length;
  return position < end ? capitalEnd : position + capitalEnd - end;
}
