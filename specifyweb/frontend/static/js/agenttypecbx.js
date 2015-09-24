define(['jquery', 'backbone'], function($, Backbone) {
    "use strict";

    return Backbone.View.extend({
        __name__: "AgentTypeCBX",
        events: {
            change: 'set'
        },
        initialize: function(info) {
            this.resource = info.resource;
            this.field = info.field.name.toLowerCase();
            this.resource.on('change:' + this.field, this.render, this);
        },
        getAgentTypes: function() {
            return ['Organization', 'Person', 'Other', 'Group'];
        },
        render: function() {
            var options = this.getAgentTypes().map(function(type, i) {
                return $('<option>').attr('value', i).text(type)[0];
            });
            this.$el.empty().append(options);
            this.$el.val(this.resource.get(this.field));
            return this;
        },
        set: function(event) {
            var val = parseInt(this.$el.val(), 10);
            this.resource.set(this.field, val);
        }
    });
});