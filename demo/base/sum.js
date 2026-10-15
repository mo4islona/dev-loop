function sumPositive(xs) {
  let total = 0;
  for (const x of xs) {
    if (x > 0) total += x;
  }
  return total;
}

module.exports = { sumPositive };
