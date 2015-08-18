define([
    'jquery', 'underscore', 'backbone', 'specifyapi', 'schema',
    'domain', 'notfoundview', 'navigation', 'treenodeview',
    'jquery-ctxmenu', 'jquery-ui', 'jquery-bbq'
], function($, _, Backbone, api, schema, domain, NotFoundView,
            navigation, TreeNodeView) {
    "use strict";
    var setTitle;


    var TreeHeader = Backbone.View.extend({
        __name__: "TreeHeader",
        className: "tree-header",
        tagName: "thead",
        initialize: function(options) {
            this.treeDefItems = options.treeDefItems;
        },
        render: function() {
            var headings = _.map(this.treeDefItems, function(tdi) {
                return $('<th>').text(tdi.get('name'))[0];
            }, this);
            $('<tr>').append(headings).appendTo(this.el);
            return this;
        }
    });

    function contextMenuBuilder(treeView) {
        return function ($target, evt) {
            var view = $target.closest('.tree-node').data('view');
            var items = {};
            if (treeView.currentAction != null) {
                var action = treeView.currentAction;
                switch (treeView.currentAction.type) {
                case 'moving':
                    if (view.rankId < action.node.rankId)
                        items.receive = {name: "Move " + action.node.name + " here"};
                    break;
                default:
                    console.error('unknown tree action:', treeView.currentAction.type);
                }
                items.cancelAction = {name: "Cancel", icon: "cancel"};
            } else {
                items = {
                    'open': {name: "Edit", icon: "form"},
                    'query': {name: "Query", icon: "query"},
                    'add-child': {name: "Add child", icon: "add-child"},
                    'move': {name: "Move", icon: "move"}
                };
            }

            return {
                items: items,
                callback: contextMenuCallback
            };
        };
    }

    function contextMenuCallback(key, options) {
        var treeView = this.closest('.tree-view').data('view');
        var treeNodeView = this.closest('.tree-node').data('view');
        var specifyModel = schema.getModel(treeView.table);
        switch (key) {
        case 'open':
            window.open(api.makeResourceViewUrl(specifyModel, treeNodeView.nodeId));
            break;
        case 'query':
            window.open('/specify/query/fromtree/' + treeNodeView.table + '/' + treeNodeView.nodeId + '/');
            break;
        case 'add-child':
            treeNodeView.openAddChildDialog();
            break;
        case 'move':
            treeNodeView.moveNode();
            break;
        case 'receive':
            treeNodeView.receiveNode();
            break;
        case 'cancelAction':
            treeView.cancelAction();
            break;
        default:
            console.error('unknown tree ctxmenu key:', key);
        }
    }


    var TreeView = Backbone.View.extend({
        __name__: "TreeView",
        className: "tree-view",
        events: {
            'autocompleteselect': 'search'
        },
        initialize: function(options) {
            this.table = options.table;
            this.treeDef = options.treeDef;
            this.treeDefItems = options.treeDefItems.models;

            this.ranks = _.map(this.treeDefItems, function(tdi) { return tdi.get('rankid'); });
            this.baseUrl = '/api/specify_tree/' + this.table + '/' + this.treeDef.id + '/';
            this.currentAction = null;
        },
        render: function() {
            this.$el.data('view', this);
            this.$el.contextMenu({
                selector: ".tree-node .expander",
                build: contextMenuBuilder(this)
            });
            var title = schema.getModel(this.table).getLocalizedName() + " Tree";
            setTitle(title);
            $('<h1>').text(title).appendTo(this.el);
            this.$el.append(this.makeSearchBox());
            var columnDefs = $('<colgroup>').append(_.map(this.ranks, function() {
                return $('<col>', {width: (100/this.ranks.length) + '%'})[0];
            }, this));
            $('<table>').appendTo(this.el).append(
                columnDefs,
                new TreeHeader({treeDefItems: this.treeDefItems}).render().el,
                $('<tfoot>').append(_.map(this.ranks, function() { return $('<th>')[0]; })),
                '<tbody><tr class="loading"><td>(loading...)</td></tr></tbody>'
            );
            $.getJSON(this.baseUrl + 'null/')
                .done(this.gotRows.bind(this));
            return this;
        },
        gotRows: function(rows) {
            this.roots = _.map(rows, function(row) {
                return new TreeNodeView({ row: row, table: this.table, ranks: this.ranks, baseUrl: this.baseUrl, treeView: this });
            }, this);
            this.$('tbody').empty();
            _.invoke(this.roots, 'render');
            var params = $.deparam.querystring();
            params.conformation && this.applyConformation(params.conformation);
        },
        search: function(event, ui) {
            this.$('.tree-search').blur();
            var roots = this.roots;
            $.getJSON('/api/specify_tree/' + this.table + '/' + ui.item.nodeId + '/path/').done(function(path) {
                var nodeIds = _(path).chain().values()
                        .filter(function(node) { return node.rankid != null; })
                        .sortBy(function(node) { return node.rankid; })
                        .pluck('id').value();
                _.invoke(roots, 'openPath', nodeIds);
            });
        },
        makeSearchBox: function() {
            var tree = schema.getModel(this.table);
            return $('<input class="tree-search" type="search" placeholder="Search Tree" tabindex="1">').autocomplete({
                source: function(request, response) {
                    var collection = new tree.LazyCollection({
                        filters: { name__istartswith: request.term, orderby: 'name' },
                        domainfilter: true
                    });
                    collection.fetch().pipe(function() {
                        var items = collection.map(function(node) {
                            return { label: node.get('fullname'), value: node.get('name'), nodeId: node.id };
                        });
                        response(items);
                    });
                }
            });
        },
        applyConformation: function(encoded) {
            var serialized = encoded.replace(/([^~])~/g, '$1,~').replace(/~/g, '[').replace(/-/g, ']');
            var conformation;
            try {
                conformation = JSON.parse(serialized);
            } catch (e) {
                console.error('bad tree conformation:', serialized);
                return;
            }
            _.each(conformation, function(conformation) {
                _.invoke(this.roots, 'applyConformation', conformation);
            }, this);
        },
        updateConformation: function() {
            var serialized = JSON.stringify(TreeNodeView.conformation(this.roots));
            // Replace reserved url characters to avoid percent
            // escaping.  Also, commas are superfluous since they
            // procede every open bracket that is not itself proceded
            // by an open bracket by nature of the construction.
            var encoded = serialized.replace(/\[/g, '~').replace(/\]/g, '-').replace(/,/g, '');
            navigation.push($.param.querystring(window.location.href, {conformation: encoded}));
        },
        moveNode: function(node) {
            this.currentAction = {
                type: 'moving',
                node: node
            };
        },
        receiveNode: function(node) {
            this.currentAction.receivingNode = node;
            var model = schema.getModel(this.table);
            var receiver = new model.Resource({id: node.nodeId});
            var target = new model.Resource({id: this.currentAction.node.nodeId });
            $.when(receiver.fetch(), target.fetch())
                .pipe(this.executeAction.bind(this, target, receiver));
        },
        executeAction: function(target, receiver) {
            var action = this.currentAction;
            switch (action.type) {
            case 'moving':
                target.set('parent', receiver.url());
                target.save().done(function() {
                    action.receivingNode.childAdded();
                    action.node.parent().childRemoved();
                });
                break;
            }
            this.currentAction = null;
        },
        cancelAction: function() {
            this.currentAction = null;
        }
    });

    return function(app) {
        setTitle = app.setTitle;

        app.router.route('tree/:table/', 'tree', function(table) {
            var getTreeDef = domain.getTreeDef(table);
            if (!getTreeDef) {
                app.setCurrentView(new NotFoundView());
                return;
            }
            getTreeDef.done(function(treeDef) {

                treeDef.rget('treedefitems').pipe(function (treeDefItems) {
                    return treeDefItems.fetch({limit: 0}).pipe(function() { return treeDefItems; });
                }).done(function(treeDefItems) {
                    app.setCurrentView(new TreeView({
                        table: table,
                        treeDef: treeDef,
                        treeDefItems: treeDefItems
                    }));
                });
            });
        });
    };
});
