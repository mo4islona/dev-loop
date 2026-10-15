const { sumPositive } = require('./sum');

class AverageStrategy {
  compute(xs) {
    throw new Error('not implemented');
  }
}

class PositiveAverageStrategy extends AverageStrategy {
  compute(xs) {
    if (xs === null || xs === undefined) return 0;
    return sumPositive(xs) / xs.length;
  }
}

function averagePositive(xs, strategy = new PositiveAverageStrategy()) {
  return strategy.compute(xs);
}

module.exports = { averagePositive };
