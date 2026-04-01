# API Documentation

This file contains executable doc tests using `mbt test` blocks.

## fib

Calculate the n-th Fibonacci number.

```mbt check
///|
test {
  inspect(fib(0), content="1")
  inspect(fib(1), content="1")
  inspect(fib(10), content="89")
}
```

## sum

Sum elements in an array with optional start index and length.

```mbt check
///|
test {
  let data = [1, 2, 3, 4, 5]
  inspect(sum(data~), content="15")
  inspect(sum(data~, start=2), content="12")
  inspect(sum(data~, length=3), content="6")
}
```
