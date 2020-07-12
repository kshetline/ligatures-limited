// www !== <= 0xA 2x3
/* www !== >= 0xA 2x3 */
export function foo(): void {
  const a = Math.random();
  const b = Math.random();
  const c = Math.random();

  // eslint-disable-next-line eqeqeq
  if (a <= b && a >= c && b != c)
    setTimeout(() => console.log('a <= b && a << c && b != c'));

  console.log(0xA, 0o65, 0b1011);
  console.log('0xA, 0o65, 0b1011');
}
