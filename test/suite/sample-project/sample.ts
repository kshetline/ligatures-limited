// www !== <=
/* www !== >= */
export function foo(): void {
  const a = Math.random();
  const b = Math.random();
  const c = Math.random();

  // eslint-disable-next-line eqeqeq
  if (a <= b && a >= c && b != c)
    setTimeout(() => console.log('a <= b && a << c && b != c'));
}
