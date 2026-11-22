"""Numbers as the pinned results hash them: a float that is a whole number counts as that whole number (4.0 is 4).
The engine is JavaScript, which has one kind of number, so a sack total comes back 4 where Python's engine gave 4.0;
the value is the same and the fingerprints must not tell them apart."""


def canon(o):
    if isinstance(o, float) and o.is_integer():
        return int(o)
    if isinstance(o, dict):
        return {k: canon(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [canon(v) for v in o]
    return o
