'use strict';
angular.module('bahmni.common.displaycontrol.custom')
  .service('erpService', ['$http', '$httpParamSerializer', 'sessionService', function($http, $httpParamSerializer, sessionService) {

    this.getOrder = function(id, representation) {
      var order = $http.get(Bahmni.Common.Constants.openmrsUrl + "/ws/rest/v1/erp/order/" + id + "?" + $httpParamSerializer({
        rep: representation
      }), {});
      return order;
    };

    this.getAllOrders = function(filters, representation) {
      var patientFilter = {
        "field": "partner_id",
        "comparison": "=",
        "value": "8"
      }
      // var patientFilter = {
      //   "field": "partner_uuid",
      //   "comparison": "=",
      //   "value": $scope.patient.uuid
      // }
      // filters.push(patientFilter)

      var orders = $http.post(Bahmni.Common.Constants.openmrsUrl + "/ws/rest/v1/erp/order?" + $httpParamSerializer({
        rep: representation
      }), {
        filters: filters
      });
      return orders;
    };

    this.getInvoice = function(id, representation) {
      var invoice = $http.get(Bahmni.Common.Constants.openmrsUrl + "/ws/rest/v1/erp/invoice/" + id + "?" + $httpParamSerializer({
        rep: representation
      }), {});
      return invoice;
    };

    this.getAllInvoices = function(filters, representation) {
      var patientFilter = {
        "field": "partner_id",
        "comparison": "=",
        "value": "8"
      }
      // var patientFilter = {
      //   "field": "partner_uuid",
      //   "comparison": "=",
      //   "value": $scope.patient.uuid
      // }
      // filters.push(patientFilter)
      var salesInvoiceFilter = {
        "field": "type",
        "comparison": "=",
        "value": "out_invoice"
      }
      filters.push(salesInvoiceFilter)
      var invoices = $http.post(Bahmni.Common.Constants.openmrsUrl + "/ws/rest/v1/erp/invoice?" + $httpParamSerializer({
        rep: representation
      }), {
        params: {
          rep: "full"
        },
        filters: filters
      });
      return invoices;
    };

  }]);

angular.module('bahmni.common.displaycontrol.custom')
  .directive('billingStatus', ['erpService', 'orderService', 'appService', 'spinner', '$q', function(erpService, orderService, appService, spinner, $q) {
    var controller = function($scope) {
      $scope.contentUrl = appService.configBaseUrl() + "/customDisplayControl/views/billingStatus.html";

      var lines = [];
      $scope.lines = [];
      $scope.debug = [];

      const ORDER = "ORDER"
      const INVOICE = "INVOICE"

      const NON_INVOICED = "NON INVOICED"
      const FULLY_INVOICED = "FULLY_INVOICED"
      const PARTIALLY_INVOICED = "PARTIALLY_INVOICED"

      const PAID = "PAID"
      const NOT_PAID = "NOT_PAID"

      const OVERDUE = "OVERDUE"
      const NOT_OVERDUE = "NOT_OVERDUE"

      var retireLinesConditions = $scope.config.retireLinesConditions
      var nonApprovedConditions = $scope.config.nonApprovedConditions
      var approvedConditions = $scope.config.approvedConditions

      var ordersFilters = [];
      var invoicesFilters = [];
      var orders = [];
      var invoices = [];

      var retrieveErpOrders = function() {
        return erpService.getAllOrders(ordersFilters, "full").then(function(response) {
          orders = response.data;
        })
      }

      var retrieveErpInvoices = function() {
        return erpService.getAllInvoices(invoicesFilters, "full").then(function(response) {
          invoices = response.data;
        })
      }

      var getOrdersAndInvoices = $q.all([retrieveErpOrders(), retrieveErpInvoices()]);
      getOrdersAndInvoices.then(function() {
        setTagsToOrderLines(orders);
        setTagsToInvoiceLines(invoices);
        setApprovalStatusToLines();
        removeRetired();
        // lines.forEach(function(line) {
        //   getVisitId(line);
        // });
      });
      $scope.initialization = getOrdersAndInvoices;

      // var getVisitId = function(line) {
      //   if (line.order != null) {
      //     var customRepresentation = Bahmni.ConceptSet.CustomRepresentationBuilder.build(['encounter_id']);
      //     orderService.getOrders({
      //       patientUuid: $scope.patient.uuid,
      //       orderUuid: line.order,
      //       includeObs: true,
      //       v: "custom:" + customRepresentation
      //     }).success(function(orders) {
      //       var order = orders;
      //       $scope.lines = lines;
      //       $scope.groupedLines = sortAndGroupByDate(lines);
      //     })
      //   }
      // }

      var removeRetired = function() {
        lines = _.filter(lines, function(o) {
          return o.retire == false;
        })
      }

      var sortAndGroupByDate = function(linesToSort) {
        return _.groupBy(
          _.orderBy(linesToSort, ['date'], ['desc']),
          function(o) {
            var day = new Date(o.date).setHours(0, 0, 0, 0);
            return day;
          })
      }

      var setApprovalStatusToLines = function() {
        lines.forEach(function(line) {
          line.approved = false;
          line.retire = false;
          approvedConditions.forEach(function(condition) {
            if (_.difference(condition, line.tags).length == 0) {
              line.approved = line.approved || true;
            }
          })
          nonApprovedConditions.forEach(function(condition) {
            if (_.difference(condition, line.tags).length == 0) {
              line.approved = line.approved || false;
            }
          })
          // set lines to retire
          retireLinesConditions.forEach(function(condition) {
            if (_.difference(condition, line.tags).length == 0) {
              line.retire = line.retire || true;
            }
          })
        })
      };

      var setTagsToOrderLines = function(orders) {
        orders.forEach(function(order) {
          order.order_lines.forEach(function(line) {
            // NON INVOICED
            var tags = []
            tags.push(ORDER);
            if (line.qty_invoiced == 0) {
              tags.push(NON_INVOICED);
            } else if (line.qty_invoiced != 0 && line.qty_to_invoice != 0) {
              // PARTIALLY_INVOICED
              tags.push(PARTIALLY_INVOICED);
            } else if (line.qty_to_invoice == 0) {
              // FULLY_INVOICED
              tags.push(FULLY_INVOICED);
            }
            lines.push({
              "id": line.id,
              "date": order.date_order,
              "document": order.name,
              "order": order.x_external_order_id,
              "tags": tags,
              "displayName": line.display_name
            })
          })
        })
        return orders;
      };

      var setTagsToInvoiceLines = function(invoices) {
        invoices.forEach(function(invoice) {
          invoice.invoice_lines.forEach(function(line) {
            var tags = [];
            tags.push(INVOICE)
            if (invoice.state == "paid") {
              tags.push(PAID);
            } else {
              tags.push(NOT_PAID);
            }
            if (new Date(invoice.date_due).getDate() >= new Date().getDate()) {
              tags.push(OVERDUE);
            } else {
              tags.push(NOT_OVERDUE);
            }
            lines.push({
              "id": line.id,
              "date": invoice.date,
              "document": invoice.number,
              "tags": tags,
              "displayName": line.display_name
            })
          })
          return invoices;
        });
      };
    };

    var link = function($scope, element) {
      spinner.forPromise($scope.initialization, element);
    };

    return {
      restrict: 'E',
      controller: controller,
      link: link,
      template: '<ng-include src="contentUrl"/>'
    }
  }])
