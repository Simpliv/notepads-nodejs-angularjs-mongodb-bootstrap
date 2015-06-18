'use strict';

let Notepad = require('../../../src/models/notepad'),
    Category = require('../../../src/models/category'),
    User = require('../../../src/models/user'),
    notepadsRouter = require('../../../src/routes/notepads'),
    assert = require('assert'),
    connection = require('../../db_common'),
    mongoose = require('mongoose'),
    Promise = require('bluebird'),
    HttpStatus = require('http-status'),
    co = require('co');

describe('Notepads Routes', function () {

    let db, testUser, testCat, testNotepads = [], req, res;

    before(done => {
        db = connection();

        co(function* () {
            testUser = yield User.createAsync({
                facebookId: +new Date(),
                name: 'Iliyan Trifonov',
                photo: 'photourl'
            });

            testCat = yield Category.createAsync({
                name: 'Test category',
                user: testUser._id
            });

            let notes = [
                {
                    title: 'Test notepad 1',
                    text: 'Test notepad 1 text',
                    category: testCat._id,
                    user: testUser._id
                },
                {
                    title: 'Test notepad 2',
                    text: 'Test notepad 2 text',
                    category: testCat._id,
                    user: testUser._id
                }
            ];

            for (let i = 0, l = notes.length; i < l; i++)
            {
                let notepad = yield Notepad.createAsync(notes[i]);
                testNotepads.push(notepad);
                testCat = yield Category.increaseNotepadsCountById(notepad.category);
                testUser = yield User.addNotepad(notepad.user, notepad._id);
            }

            done();
        });
    });

    beforeEach(() => {
        req = {
            user: {
                id: testUser._id
            }
        };

        res = {
            status: function(status) {
                if (!this.statusExpected) {
                    throw new Error('unconfigured response object!');
                }
                assert.strictEqual(status, this.statusExpected);
                return this;
            },
            json: function(obj) {
                if (!this.jsonChecker) {
                    throw new Error('unconfigured response object!');
                }
                this.jsonChecker(obj);
            }
        };
    });

    after(done => {
        co(function* () {
            yield User.removeAsync({});
            yield Category.removeAsync({});
            yield Notepad.removeAsync({});
            db.close();
            done();
        });
    });

    describe('checkAuth', () => {
        it('should return UNAUTHORIZED when user is not authenticated', () => {
            req.isAuthenticated = () => {
                return false;
            };
            let oldConsoleError = console.error;
            console.error = msg => {
                assert.strictEqual(msg, 'API notepads: checkAuth(), not authenticated!');
                console.error = oldConsoleError;
            };
            res.statusExpected = HttpStatus.UNAUTHORIZED;
            res.jsonChecker = obj => {
                assert.deepEqual(obj, {});
            };
            notepadsRouter.checkAuth(req, res);
        });

        it('should call next if user is authenticated', done => {
            req.isAuthenticated = () => {
                return true;
            };
            let next = () => {
                assert.strictEqual(arguments.length, 0);
                done();
            };
            notepadsRouter.checkAuth(req, res, next);
        });
    });

    describe('insidecatsFromQueryString', () => {
        it('should add req.params.insidecats if existing in req.query.insidecats', done => {
            req.query = { insidecats: 1 };
            let next = () => {
                assert.strictEqual(arguments.length, 0);
                assert.strictEqual(req.params.insidecats, "1");
                done();
            };
            notepadsRouter.insidecatsFromQueryString()(req, res, next);
        });

        it('should call next(route) if req.query.insidecats is not set', done => {
            req.query = {};
            let next = function() {
                assert.strictEqual(arguments.length, 1);
                assert.strictEqual(arguments[0], "route");
                done();
            };
            notepadsRouter.insidecatsFromQueryString()(req, res, next);
        });
    });

    describe('getNotepadsHandler', () => {
       it('should return an empty array result if user with no notepads and categories is given', done => {
           co(function* () {
              let user = yield User.createAsync({
                  facebookId: +new Date(),
                  name: 'Temp User',
                  photo: 'photourl'
              });

               req.user.id = user._id;
               res.statusExpected = HttpStatus.OK;
               res.jsonChecker = obj => {
                   assert.deepEqual(obj, []);
                   done();
               };

               notepadsRouter.getNotepadsHandler(req, res);
           });
        });

        it('should return only the categories with no notepads if such user is requested', done => {
            co(function* () {
                let cats = [
                    { name: 'Test Cat1' },
                    { name: 'Test Cat2' }
                ];

                let user = yield User.createAsync({
                    facebookId: +new Date(),
                    name: 'Temp User',
                    photo: 'photourl'
                });

                req.user.id = user._id;

                for (let i = 0, l = cats.length; i < l; i++) {
                    yield Category.createAsync({
                        name: cats[i].name,
                        user: user
                    });
                }

                res.statusExpected = HttpStatus.OK;
                res.jsonChecker = obj => {
                    assert.strictEqual(obj.length, cats.length);
                    assert.ok(obj[0].name === cats[0].name || obj[0].name === cats[1].name);
                    assert.ok(obj[1].name === cats[0].name || obj[1].name === cats[1].name);
                    assert.strictEqual(obj[0].notepads.length, 0);
                    assert.strictEqual(obj[1].notepads.length, 0);
                    done();
                };

                notepadsRouter.getNotepadsHandler(req, res);
            });
        });

        it('should return the categories and notepads for a user', done => {
            res.statusExpected = HttpStatus.OK;
            res.jsonChecker = obj => {
                //1 category
                assert.strictEqual(obj.length, 1);
                //2 notepads
                assert.strictEqual(obj[0].notepads.length, 2);
                done();
            };

            notepadsRouter.getNotepadsHandler(req, res);
        });
    });

    describe('getNotepadByIdHandler', () => {
        it('should return NO_CONTENT if no notepad is found', done => {
            req.params = {};
            res.execDone = false;
            res.statusExpected = HttpStatus.NO_CONTENT;
            res.jsonChecker = obj => {
                assert.deepEqual(obj, {});
                //allow a second call before done
                if (!res.execDone) {
                    res.execDone = true;
                } else {
                    done();
                }
            };

            notepadsRouter.getNotepadByIdHandler(req, res);

            //second call
            req.params.id = mongoose.Types.ObjectId();
            notepadsRouter.getNotepadByIdHandler(req, res);
        });

        it('should return a notepad given a valid existing notepad and user id', done => {
            req.params = { id: testNotepads[0]._id };
            req.user = { id: testUser._id };
            res.statusExpected = HttpStatus.OK;
            res.jsonChecker = obj => {
                assert.ok(obj._id.equals(testNotepads[0]._id));
                done();
            };

            notepadsRouter.getNotepadByIdHandler(req, res);
        });
    });

    describe('postNotepadsHandler', () => {
        it('should return NO_CONTENT when the category given is not found', done => {
            req.body = { category: mongoose.Types.ObjectId() };
            req.user = { id: testUser._id };
            res.statusExpected = HttpStatus.NO_CONTENT;
            res.jsonChecker = obj => {
                assert.deepEqual(obj, {});
                done();
            };

            notepadsRouter.postNotepadsHandler(req, res);
        });

        //TODO: convert this to BAD_REQUEST with added checking for the required params
        it('should return INTERNAL SERVER ERROR when there is an error in Notepad.createAsync (like not enough of the required params)', done => {
            req.body = { category: testCat._id };
            req.user = { id: testUser._id };
            res.statusExpected = HttpStatus.INTERNAL_SERVER_ERROR;
            res.jsonChecker = obj => {
                assert.deepEqual(obj, {});
                done();
            };

            notepadsRouter.postNotepadsHandler(req, res);
        });

        it('should return the created notepad and the User and Category should be with updated values', done => {
            req.body = {
                title: 'Test title',
                text: 'Test text',
                category: testCat._id
            };
            req.user = { id: testUser._id };
            res.statusExpected = HttpStatus.OK;
            res.jsonChecker = obj => {
                co(function* () {
                    //check the notepad object
                    assert.ok(obj);
                    assert.strictEqual(obj.user, req.user.id);
                    assert.strictEqual(obj.category, req.body.category);
                    assert.strictEqual(obj.title, req.body.title);
                    assert.strictEqual(obj.text, req.body.text);

                    //add the new notepad to the tested ones
                    testNotepads.push(obj);

                    //check category values
                    let cat = yield Category.findOneAsync({ _id: testCat._id });
                    assert.strictEqual(cat.notepadsCount, testCat.notepadsCount + 1);
                    testCat = cat;

                    //check user values
                    let user = yield User.findOneAsync({ _id: testUser._id, notepads: obj._id });
                    assert.strictEqual(user.notepads.length, testUser.notepads.length + 1);
                    testUser = user;

                    done();
                });
            };

            notepadsRouter.postNotepadsHandler(req, res);
        });
    });

    describe('putNotepadsIdHandler', () => {
        it('should return BAD_REQUEST when a required param is not given', done => {
            let paramsToCheck = 4;
            req.params = {};
            req.body = {};
            res.statusExpected = HttpStatus.BAD_REQUEST;
            res.jsonChecker = obj => {
                assert.deepEqual(obj, {});
                if (--paramsToCheck === 0) {
                    done();
                }
            };

            notepadsRouter.putNotepadsIdHandler(req, res);

            req.params.id = testNotepads._id;
            notepadsRouter.putNotepadsIdHandler(req, res);

            req.body.title = 'Test notepad';
            notepadsRouter.putNotepadsIdHandler(req, res);

            req.body.text = 'Test text';
            notepadsRouter.putNotepadsIdHandler(req, res);
        });

        it('should return NO_CONTENT when the given notepad id is not found', done => {
            req.params = { id: mongoose.Types.ObjectId() };
            req.user = { id: testUser._id };
            req.body = {
                title: 'test',
                text: 'test',
                category: testCat._id
            };
            res.statusExpected = HttpStatus.NO_CONTENT;
            res.jsonChecker = obj => {
                assert.deepEqual(obj, {});
                done();
            };

            notepadsRouter.putNotepadsIdHandler(req, res);
        });

        it('should return the updated Notepad object', done => {
            req.params = { id: testNotepads[0]._id };
            req.user = { id: testUser._id };
            req.body = {
                title: 'test',
                text: 'test',
                category: testCat._id
            };
            res.statusExpected = HttpStatus.OK;
            res.jsonChecker = obj => {
                assert.ok(obj);
                assert.notDeepEqual(obj, {});
                assert.strictEqual(obj.title, req.body.title);
                assert.strictEqual(obj.text, req.body.text);
                assert.ok(obj.category.equals(req.body.category));
                assert.ok(obj.user.equals(req.user.id));
                testNotepads[0] = obj;
                done();
            };

            notepadsRouter.putNotepadsIdHandler(req, res);
        });

        it('should return the updated Notepad object + category change', done => {
            co(function* () {
                let cat, notepad;
                req.user = { id: testUser._id };

                //create a new cat
                cat = yield Category.createAsync({
                    name: 'Test cat 2',
                    user: testUser
                });

                //create a new notepad for that cat
                notepad = yield Notepad.createAsync({
                    title: 'Temp notepad',
                    text: 'Temp text',
                    category: cat._id,
                    user: testUser._id
                });

                req.params = {id: notepad._id};

                //update User and Category values
                testUser = yield User.addNotepad(testUser._id, notepad._id);
                cat = yield Category.increaseNotepadsCountById({_id: cat._id});

                assert.strictEqual(cat.notepadsCount, 1);

                req.body = {
                    title: 'test',
                    text: 'test',
                    category: testCat._id
                };

                res.statusExpected = HttpStatus.OK;

                res.jsonChecker = obj => {
                    co(function* () {
                        //check the notepad
                        assert.ok(obj);
                        assert.notDeepEqual(obj, {});
                        assert.strictEqual(obj.title, req.body.title);
                        assert.strictEqual(obj.text, req.body.text);
                        assert.ok(obj.category.equals(testCat._id));
                        assert.ok(obj.user.equals(req.user.id));

                        //add the new notepad to the testing ones
                        testNotepads.push(obj);

                        //check the new category changes - notepads num decreased
                        let c = yield Category.findOneAsync({
                            _id: cat._id
                        });
                        assert.strictEqual(c.notepadsCount, 0);

                        //check the testingCat changes - notepads num increased
                        testCat = yield Category.findOneAsync({ _id: testCat._id });
                        assert.strictEqual(testCat.notepadsCount, testNotepads.length);

                        done();
                    });
                };

                //check before the changes are made
                assert.strictEqual(testCat.notepadsCount, testNotepads.length);

                notepadsRouter.putNotepadsIdHandler(req, res);
            });
        });

    });

    describe('deleteNotepadsIdHandler', () => {
        it('should return NO_CONTENT if the Notepad is not found by the given params', done => {
            req.params = req.user = {};
            res.statusExpected = HttpStatus.NO_CONTENT;
            res.jsonChecker = obj => {
                assert.deepEqual(obj, {});

                done();
            };

            notepadsRouter.deleteNotepadsIdHandler(req, res);
        });

        it('should delete the notepad, update the entries in User and Category and return the deleted notepad object', done => {
            let note = testNotepads[testNotepads.length - 1];
            req.params = { id: note._id };
            req.user = { id: testUser._id };
            res.statusExpected = HttpStatus.OK;

            res.jsonChecker = obj => {
                co(function* () {
                    //check the notepad changes
                    assert.ok(obj);
                    assert.notDeepEqual(obj, {});
                    assert.ok(obj._id.equals(note._id));
                    assert.strictEqual(obj.title, note.title);

                    let cat = yield Category.findOneAsync({ _id: note.category });
                    assert.strictEqual(cat.notepadsCount, testCat.notepadsCount - 1);

                    testCat = cat;
                    testNotepads.pop();

                    let user = yield User.findOneAsync({ _id: note.user });
                    assert.strictEqual(user.notepads.length, testUser.notepads.length - 1);

                    testUser = user;

                    done();
                });
            };

            notepadsRouter.deleteNotepadsIdHandler(req, res);
        });
    });

});
