const { sumPositive } = require('./sum');

class AverageStrategy {
  compute(xs) {
    throw new Error('not implemented');
  }
}

class PositiveAverageStrategy extends AverageStrategy {
  compute(xs) {
    if (xs === null || xs === undefined) return 0;
    const count = xs.filter((x) => x >= 0).length;
    if (count === 0) return 0;
    return sumPositive(xs) / count;
  }
}

function averagePositive(xs, strategy = new PositiveAverageStrategy()) {
  return strategy.compute(xs);
}

module.exports = { averagePositive };
