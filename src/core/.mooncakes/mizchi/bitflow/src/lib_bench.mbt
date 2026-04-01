///|
test "fib benchmark" (b : @bench.T) {
  b.bench(fn() { ignore(fib(20)) })
}

///|
test "sum benchmark" (b : @bench.T) {
  let data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  b.bench(fn() { ignore(sum(data~)) })
}
