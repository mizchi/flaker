///|
fn clamp_count(count : Int, total : Int) -> Int {
  if count <= 0 {
    0
  } else if count > total {
    total
  } else {
    count
  }
}

///|
fn lcg_next(state : UInt64) -> UInt64 {
  state * 6364136223846793005UL + 1442695040888963407UL
}

///|
pub fn sample_random(
  meta : Array[@types.TestMeta],
  count~ : Int,
  seed~ : UInt64,
) -> Array[@types.TestMeta] {
  let n = meta.length()
  if n == 0 {
    return []
  }
  let actual_count = clamp_count(count, n)
  if actual_count == 0 {
    return []
  }
  // Copy array for Fisher-Yates shuffle
  let arr = Array::makei(n, fn(i) { meta[i] })
  let mut state = seed
  for i in 0..<actual_count {
    state = lcg_next(state)
    let remaining = (n - i).to_uint64()
    let j = i + (state % remaining).to_int()
    arr.swap(i, j)
  }
  Array::makei(actual_count, fn(i) { arr[i] })
}

///|
pub fn sample_weighted(
  meta : Array[@types.TestMeta],
  count~ : Int,
  seed~ : UInt64,
) -> Array[@types.TestMeta] {
  let n = meta.length()
  if n == 0 {
    return []
  }
  let actual_count = clamp_count(count, n)
  if actual_count == 0 {
    return []
  }
  // Build weights
  let weights = Array::makei(n, fn(i) { 1.0 + meta[i].flaky_rate + meta[i].co_failure_boost })
  let selected : Array[@types.TestMeta] = []
  let used = Array::make(n, false)
  let mut state = seed
  for _ in 0..<actual_count {
    // Compute total weight of unused items
    let mut total_weight = 0.0
    for i in 0..<n {
      if !used[i] {
        total_weight = total_weight + weights[i]
      }
    }
    // Generate random value in [0, total_weight)
    state = lcg_next(state)
    let rand_val = (state % 1000000UL).to_int().to_double() /
      1000000.0 *
      total_weight
    // Select based on cumulative weight
    let mut cumulative = 0.0
    let mut picked = -1
    for i in 0..<n {
      if !used[i] {
        cumulative = cumulative + weights[i]
        if cumulative > rand_val && picked < 0 {
          picked = i
        }
      }
    }
    // Fallback: pick last unused
    if picked < 0 {
      for i = n - 1; i >= 0; i = i - 1 {
        if !used[i] {
          picked = i
          break
        }
      }
    }
    used[picked] = true
    selected.push(meta[picked])
  }
  selected
}

///|
pub fn sample_hybrid(
  meta : Array[@types.TestMeta],
  affected_suites~ : Array[String],
  count~ : Int,
  seed~ : UInt64,
) -> Array[@types.TestMeta] {
  let actual_count = clamp_count(count, meta.length())
  if actual_count == 0 {
    return []
  }
  let affected_set : Map[String, Bool] = {}
  for s in affected_suites {
    affected_set.set(s, true)
  }

  let selected : Array[@types.TestMeta] = []
  let used : Map[Int, Bool] = {}

  // Priority 1: affected tests
  for i, m in meta {
    if affected_set.contains(m.suite) && !used.contains(i) {
      selected.push(m)
      used.set(i, true)
    }
  }

  // Priority 2: previously failed tests
  for i, m in meta {
    if m.previously_failed && !used.contains(i) {
      selected.push(m)
      used.set(i, true)
    }
  }

  // Priority 3: new tests
  for i, m in meta {
    if m.is_new && !used.contains(i) {
      selected.push(m)
      used.set(i, true)
    }
  }

  // Priority 4: fill remaining with weighted random
  if selected.length() < actual_count {
    let remaining : Array[@types.TestMeta] = []
    for i, m in meta {
      if !used.contains(i) {
        remaining.push(m)
      }
    }
    let needed = actual_count - selected.length()
    let extra = sample_weighted(remaining, count=needed, seed~)
    for m in extra {
      selected.push(m)
    }
  }

  if selected.length() > actual_count {
    Array::makei(actual_count, fn(i) { selected[i] })
  } else {
    selected
  }
}
