var tape = require("tape");

var protobuf = require("..");

var root = new protobuf.Root().addJSON(protobuf.common["google/protobuf/any.proto"].nested).addJSON({
    Foo: {
        fields: {
            foo: {
                id: 1,
                type: "google.protobuf.Any"
            }
        }
    },
    Bar: {
        fields: {
            bar: {
                id: 1,
                type: "string"
            }
        }
    },
    Loop: {
        fields: {
            next: {
                id: 1,
                type: "google.protobuf.Any"
            }
        }
    }
}).resolveAll();

var Any = root.lookupType("protobuf.Any"),
    Foo = root.lookupType(".Foo"),
    Bar = root.lookupType(".Bar"),
    Loop = root.lookupType(".Loop");

tape.test("google.protobuf.Any", function(test) {

    var foo = Foo.fromObject({
        foo: {
            type_url: "Bar",
            value: [1 << 3 | 2, 1, 97] // value = "a"
        }
    });
    test.ok(foo.foo instanceof Any.ctor, "should keep explicit Any in fromObject");
    test.same(foo.foo, { type_url: "Bar", value: [10, 1, 97] }, "should keep explicit Any in fromObject properly");

    var obj = Foo.toObject(foo);
    test.same(obj.foo, { type_url: "Bar", value: [10, 1, 97] }, "should keep explicit Any in toObject properly");

    obj = Foo.toObject(foo, { json: true });
    test.same(obj.foo, { "@type": "type.googleapis.com/Bar", bar: "a" }, "should decode explicitly Any in toObject if requested");

    foo = Foo.fromObject({
        foo: {
            "@type": ".Bar",
            bar: "a"
        }
    });
    test.ok(foo.foo instanceof Any.ctor, "should convert to Any in fromObject");
    test.same(foo.foo, { type_url: "/Bar", value: protobuf.util.newBuffer([10, 1, 97]) }, "should have correct Any object when converted with fromObject");

    var baz = Foo.fromObject({
        foo: {
            type_url: "type.someurl.com/Bar",
            value: [1 << 3 | 2, 1, 97] // value = "a"
        }
    });
    obj = Foo.toObject(baz, { json: true });
    test.same(obj.foo, { "@type": "type.someurl.com/Bar", bar: "a" }, "should keep prefix in type url");

    test.end();
});

tape.test("google.protobuf.Any - toObject recursion limit", function(test) {

    var recursionLimit = protobuf.util.recursionLimit;
    protobuf.util.recursionLimit = 3;
    try {
        var value = Loop.encode(Loop.create()).finish();
        for (var i = 0; i < 5; ++i)
            value = Loop.encode(Loop.create({
                next: Any.create({
                    type_url: "type.googleapis.com/Loop",
                    value: value
                })
            })).finish();

        var message = Loop.decode(value);

        test.throws(function() {
            JSON.stringify(message);
        }, /max depth exceeded/, "should reject excessive Any JSON expansion depth");
    } finally {
        protobuf.util.recursionLimit = recursionLimit;
    }

    test.end();
});

tape.test("google.protobuf.Any - deeply nested payload with default limits", function(test) {

    // A crafted binary payload with deeply nested Any values must not be able to
    // exhaust the call stack while being expanded to JSON (CVE-2026-48712).
    function payload(depth) {
        var value = Loop.encode(Loop.create()).finish();
        for (var i = 0; i < depth; ++i)
            value = Loop.encode(Loop.create({
                next: Any.create({
                    type_url: "type.googleapis.com/Loop",
                    value: value
                })
            })).finish();
        return value;
    }

    test.equal(protobuf.util.recursionLimit, 100, "should use the default recursion limit");

    var shallow = Loop.toObject(Loop.decode(payload(10)), { json: true });
    test.equal(shallow.next["@type"], "type.googleapis.com/Loop", "should still expand Any payloads nested below the limit");
    test.equal(shallow.next.next["@type"], "type.googleapis.com/Loop", "should still expand nested Any payloads below the limit");

    var message = Loop.decode(payload(500));

    test.throws(function() {
        JSON.stringify(message);
    }, /max depth exceeded/, "should reject deeply nested Any payloads via JSON.stringify");
    test.throws(function() {
        message.toJSON();
    }, /max depth exceeded/, "should reject deeply nested Any payloads via Message#toJSON");
    test.throws(function() {
        Loop.toObject(message, { json: true });
    }, /max depth exceeded/, "should reject deeply nested Any payloads via Type.toObject");

    test.end();
});
