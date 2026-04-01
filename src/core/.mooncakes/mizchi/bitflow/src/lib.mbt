///|
/// Calculate the n-th Fibonacci number.
///
/// ```mbt check
/// test {
///   inspect(fib(10), content="89")
/// }
/// ```
pub fn fib(n : Int) -> Int64 {
  loop (n, 0L, 1L) {
    (0, _, b) => b
    (i, a, b) => continue (i - 1, b, a + b)
  }
}

///|
/// data is a labelled argument without default value having type Array[Int]
/// start is an optional labelled argument with default value 0 having type Int
/// length is an optional labelled argument without default value having type Option[Int]
pub fn sum(data~ : Array[Int], start? : Int = 0, length? : Int) -> Int {
  let end = if length is Some(length) { start + length } else { data.length() }
  let mut total = 0
  for i = start; i < end; i = i + 1 {
    total = total + data[i]
  }
  total
}
