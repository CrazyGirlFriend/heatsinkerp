/** Generated from backend OpenAPI. Run npm run api:generate; do not edit. */
export interface paths {
  '/api/access/lock': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Lock */
    post: operations['lock_api_access_lock_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/access/status': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Access Status */
    get: operations['access_status_api_access_status_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/access/unlock': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Unlock */
    post: operations['unlock_api_access_unlock_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/accounts': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** List Users */
    get: operations['list_users_api_accounts_get']
    put?: never
    /** Create User */
    post: operations['create_user_api_accounts_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/accounts/{user_id}': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Get User */
    get: operations['get_user_api_accounts__user_id__get']
    put?: never
    post?: never
    /** Delete User */
    delete: operations['delete_user_api_accounts__user_id__delete']
    options?: never
    head?: never
    /** Update User */
    patch: operations['update_user_api_accounts__user_id__patch']
    trace?: never
  }
  '/api/auth/change-password': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Change Password */
    post: operations['change_password_api_auth_change_password_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/auth/login': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Login */
    post: operations['login_api_auth_login_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/auth/logout': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Logout */
    post: operations['logout_api_auth_logout_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/auth/me': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Auth Me */
    get: operations['auth_me_api_auth_me_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    /** Update Profile */
    patch: operations['update_profile_api_auth_me_patch']
    trace?: never
  }
  '/api/business-notices': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Inbox */
    get: operations['inbox_api_business_notices_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/business-notices/{source}/{notice_id}/read': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Mark Read */
    post: operations['mark_read_api_business_notices__source___notice_id__read_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/business-notices/{source}/{notice_id}/target': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Target */
    get: operations['target_api_business_notices__source___notice_id__target_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/business-notices/read-all': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Read All */
    post: operations['read_all_api_business_notices_read_all_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/factory-dashboard': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Get Dashboard */
    get: operations['get_dashboard_api_factory_dashboard_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/factory-dashboard/deliveries': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Get Deliveries */
    get: operations['get_deliveries_api_factory_dashboard_deliveries_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/factory-dashboard/delivery-plan': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Get Plan */
    get: operations['get_plan_api_factory_dashboard_delivery_plan_get']
    /** Save Plan */
    put: operations['save_plan_api_factory_dashboard_delivery_plan_put']
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/factory-dashboard/serials': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Get Serials */
    get: operations['get_serials_api_factory_dashboard_serials_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/factory-dashboard/shipments': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Get Shipments */
    get: operations['get_shipments_api_factory_dashboard_shipments_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/factory-dashboard/stock-detail': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Get Stock Detail */
    get: operations['get_stock_detail_api_factory_dashboard_stock_detail_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/factory-dashboard/team-yields': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Get Team Yields */
    get: operations['get_team_yields_api_factory_dashboard_team_yields_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/factory-dashboard/yields': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Get Yields */
    get: operations['get_yields_api_factory_dashboard_yields_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/factory-overview': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Overview Endpoint */
    get: operations['overview_endpoint_api_factory_overview_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/factory-overview/changes': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Changes Endpoint */
    get: operations['changes_endpoint_api_factory_overview_changes_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/factory-overview/stream': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Inventory Endpoint */
    get: operations['inventory_endpoint_api_factory_overview_stream_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/factory-performance': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Report */
    get: operations['report_api_factory_performance_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/health': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Health */
    get: operations['health_api_health_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/inspections': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Records */
    get: operations['records_api_inspections_get']
    put?: never
    /** Create */
    post: operations['create_api_inspections_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/inspections/{inspection_id}/recheck-context': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Recheck Context */
    get: operations['recheck_context_api_inspections__inspection_id__recheck_context_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/inspections/sources': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Sources */
    get: operations['sources_api_inspections_sources_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/main-system/configuration': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Get Configuration */
    get: operations['get_configuration_api_main_system_configuration_get']
    /** Save Configuration */
    put: operations['save_configuration_api_main_system_configuration_put']
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/main-system/configuration/test': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Test Configuration */
    post: operations['test_configuration_api_main_system_configuration_test_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/main-system/serial-material': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Lookup Serial */
    get: operations['lookup_serial_api_main_system_serial_material_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/main-system/warehouses/{team_id}/receipts': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Receive From Main System */
    post: operations['receive_from_main_system_api_main_system_warehouses__team_id__receipts_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/material-dispatches/{dispatch_no}': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Get Dispatch */
    get: operations['get_dispatch_api_material_dispatches__dispatch_no__get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/material-dispatches/{dispatch_no}/confirm': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Confirm Dispatch */
    post: operations['confirm_dispatch_api_material_dispatches__dispatch_no__confirm_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/material-dispatches/{dispatch_no}/confirm-outbound': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Confirm Outbound */
    post: operations['confirm_outbound_api_material_dispatches__dispatch_no__confirm_outbound_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/material-input-suggestions': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Material Input Suggestions */
    get: operations['material_input_suggestions_api_material_input_suggestions_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/material-trace': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Get Serial Trace */
    get: operations['get_serial_trace_api_material_trace_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/material-transfers': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** List Material Transfers */
    get: operations['list_material_transfers_api_material_transfers_get']
    put?: never
    /** Create Material Transfer */
    post: operations['create_material_transfer_api_material_transfers_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/material-transfers/{batch_no}': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Get Material Transfer */
    get: operations['get_material_transfer_api_material_transfers__batch_no__get']
    put?: never
    post?: never
    /** Void Material Transfer */
    delete: operations['void_material_transfer_api_material_transfers__batch_no__delete']
    options?: never
    head?: never
    /** Update Material Transfer */
    patch: operations['update_material_transfer_api_material_transfers__batch_no__patch']
    trace?: never
  }
  '/api/material-transfers/{batch_no}/amendments': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** List Amendments */
    get: operations['list_amendments_api_material_transfers__batch_no__amendments_get']
    put?: never
    /** Post Amendment */
    post: operations['post_amendment_api_material_transfers__batch_no__amendments_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/material-transfers/{batch_no}/confirm': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Confirm Material Transfer */
    post: operations['confirm_material_transfer_api_material_transfers__batch_no__confirm_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/material-transfers/{batch_no}/confirm-outbound': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Confirm Outbound */
    post: operations['confirm_outbound_api_material_transfers__batch_no__confirm_outbound_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/material-transfers/{batch_no}/delivery': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    /** Update Delivery */
    patch: operations['update_delivery_api_material_transfers__batch_no__delivery_patch']
    trace?: never
  }
  '/api/material-transfers/{batch_no}/receipt-documents': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Receipt Documents */
    get: operations['receipt_documents_api_material_transfers__batch_no__receipt_documents_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/material-transfers/{batch_no}/reject': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Reject Material Transfer */
    post: operations['reject_material_transfer_api_material_transfers__batch_no__reject_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/notifications/status': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Notification Status */
    get: operations['notification_status_api_notifications_status_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/process-routes': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** List Routes */
    get: operations['list_routes_api_process_routes_get']
    put?: never
    /** Create Draft */
    post: operations['create_draft_api_process_routes_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/process-routes/{route_id}': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Detail */
    get: operations['detail_api_process_routes__route_id__get']
    /** Save Draft */
    put: operations['save_draft_api_process_routes__route_id__put']
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/process-routes/{route_id}/bind': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Bind */
    post: operations['bind_api_process_routes__route_id__bind_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/process-routes/{route_id}/dispatch-order': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Dispatch Order */
    get: operations['dispatch_order_api_process_routes__route_id__dispatch_order_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/process-routes/{route_id}/drawings': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Upload Drawing */
    post: operations['upload_drawing_api_process_routes__route_id__drawings_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/process-routes/{route_id}/drawings/{drawing_id}': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Download Drawing */
    get: operations['download_drawing_api_process_routes__route_id__drawings__drawing_id__get']
    put?: never
    post?: never
    /** Remove Drawing */
    delete: operations['remove_drawing_api_process_routes__route_id__drawings__drawing_id__delete']
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/process-routes/{route_id}/order': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Download Order */
    get: operations['download_order_api_process_routes__route_id__order_get']
    put?: never
    /** Attach Order */
    post: operations['attach_order_api_process_routes__route_id__order_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/process-routes/{route_id}/publish': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Publish */
    post: operations['publish_api_process_routes__route_id__publish_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/process-routes/{route_id}/revise': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Revise */
    post: operations['revise_api_process_routes__route_id__revise_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/process-routes/{route_id}/rework-rounds': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Rework Rounds */
    get: operations['rework_rounds_api_process_routes__route_id__rework_rounds_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/process-routes/{route_id}/source': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Source */
    get: operations['source_api_process_routes__route_id__source_get']
    put?: never
    /** Attach Word */
    post: operations['attach_word_api_process_routes__route_id__source_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/process-routes/drawing-preview': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Preview Uploaded Drawing */
    post: operations['preview_uploaded_drawing_api_process_routes_drawing_preview_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/process-routes/import': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Import Word */
    post: operations['import_word_api_process_routes_import_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/process-routes/lots/{lot_id}': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Lot Route */
    get: operations['lot_route_api_process_routes_lots__lot_id__get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/process-routes/options/{team_id}': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Execution Options */
    get: operations['execution_options_api_process_routes_options__team_id__get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/process-routes/parse': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Parse Word */
    post: operations['parse_word_api_process_routes_parse_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/process-routes/parse-order': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Parse Order File */
    post: operations['parse_order_file_api_process_routes_parse_order_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/process-routes/resolve': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Resolve Route */
    get: operations['resolve_route_api_process_routes_resolve_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/process-routes/rework-lots/{lot_id}/resume': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Resume Rework Route */
    post: operations['resume_rework_route_api_process_routes_rework_lots__lot_id__resume_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/process-routes/rework-requests': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Request Rework Route */
    post: operations['request_rework_route_api_process_routes_rework_requests_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/process-routes/rework-sources': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Rework Sources */
    get: operations['rework_sources_api_process_routes_rework_sources_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/production-schedules': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** List Schedules */
    get: operations['list_schedules_api_production_schedules_get']
    put?: never
    /** Create Schedule */
    post: operations['create_schedule_api_production_schedules_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/production-schedules/{schedule_id}': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Detail */
    get: operations['detail_api_production_schedules__schedule_id__get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    /** Update */
    patch: operations['update_api_production_schedules__schedule_id__patch']
    trace?: never
  }
  '/api/production-schedules/{schedule_id}/batches': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    /** Update Batches */
    put: operations['update_batches_api_production_schedules__schedule_id__batches_put']
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/production-schedules/{schedule_id}/cancel': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Cancel */
    post: operations['cancel_api_production_schedules__schedule_id__cancel_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/production-schedules/{schedule_id}/commitment': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    /** Update Commitment */
    patch: operations['update_commitment_api_production_schedules__schedule_id__commitment_patch']
    trace?: never
  }
  '/api/production-schedules/{schedule_id}/review': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Review Plan */
    post: operations['review_plan_api_production_schedules__schedule_id__review_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/production-schedules/business-people': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** List Business People */
    get: operations['list_business_people_api_production_schedules_business_people_get']
    put?: never
    /** Create Business Person */
    post: operations['create_business_person_api_production_schedules_business_people_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/production-schedules/business-people/{person_id}': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    /** Update Business Person */
    patch: operations['update_business_person_api_production_schedules_business_people__person_id__patch']
    trace?: never
  }
  '/api/production-schedules/candidates': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Candidates */
    get: operations['candidates_api_production_schedules_candidates_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/production-schedules/inventory': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Inventory */
    post: operations['inventory_api_production_schedules_inventory_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/production-schedules/order-preview': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Preview Order Original */
    post: operations['preview_order_original_api_production_schedules_order_preview_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/production-schedules/overview': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Get Overview */
    get: operations['get_overview_api_production_schedules_overview_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/production-schedules/parse-order': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Preview Order */
    post: operations['preview_order_api_production_schedules_parse_order_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/production-schedules/route-options': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** New Task Route Options */
    get: operations['new_task_route_options_api_production_schedules_route_options_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/production-schedules/serial-options': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Serial Options */
    get: operations['serial_options_api_production_schedules_serial_options_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/production-schedules/source-options': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Source Options */
    get: operations['source_options_api_production_schedules_source_options_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/production-schedules/tasks': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** List Tasks */
    get: operations['list_tasks_api_production_schedules_tasks_get']
    put?: never
    /** Create Task */
    post: operations['create_task_api_production_schedules_tasks_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/production-schedules/tasks/{task_id}': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Task Detail */
    get: operations['task_detail_api_production_schedules_tasks__task_id__get']
    put?: never
    post?: never
    /** Delete Task */
    delete: operations['delete_task_api_production_schedules_tasks__task_id__delete']
    options?: never
    head?: never
    /** Update Task */
    patch: operations['update_task_api_production_schedules_tasks__task_id__patch']
    trace?: never
  }
  '/api/production-schedules/tasks/{task_id}/lock': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    /** Lock Task */
    put: operations['lock_task_api_production_schedules_tasks__task_id__lock_put']
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/production-schedules/tasks/{task_id}/order': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Download Order */
    get: operations['download_order_api_production_schedules_tasks__task_id__order_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/production-schedules/tasks/{task_id}/rework': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Link Task Rework */
    post: operations['link_task_rework_api_production_schedules_tasks__task_id__rework_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/production-schedules/tasks/{task_id}/rework-options': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Task Rework Options */
    get: operations['task_rework_options_api_production_schedules_tasks__task_id__rework_options_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/production-schedules/tasks/{task_id}/route': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Link Task Route */
    post: operations['link_task_route_api_production_schedules_tasks__task_id__route_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/production-schedules/tasks/{task_id}/route-options': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Task Route Options */
    get: operations['task_route_options_api_production_schedules_tasks__task_id__route_options_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/quality-feedback': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Records */
    get: operations['records_api_quality_feedback_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/quality-feedback/{issue_id}': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Detail */
    get: operations['detail_api_quality_feedback__issue_id__get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/quality-feedback/{issue_id}/decision': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Decide */
    post: operations['decide_api_quality_feedback__issue_id__decision_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/quality-feedback/{issue_id}/reply': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Reply */
    post: operations['reply_api_quality_feedback__issue_id__reply_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/quality-feedback/{issue_id}/rework-stock': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Rework Stock */
    get: operations['rework_stock_api_quality_feedback__issue_id__rework_stock_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/receipt-documents/{document_id}': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Read Document */
    get: operations['read_document_api_receipt_documents__document_id__get']
    put?: never
    post?: never
    /** Delete Upload */
    delete: operations['delete_upload_api_receipt_documents__document_id__delete']
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/receipt-documents/{document_id}/file': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Download Document */
    get: operations['download_document_api_receipt_documents__document_id__file_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/rework-notices': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** List Notices */
    get: operations['list_notices_api_rework_notices_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/rework-notices/{notice_id}/read': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Mark Read */
    post: operations['mark_read_api_rework_notices__notice_id__read_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/rework-notices/{notice_id}/route': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Notice Route */
    get: operations['notice_route_api_rework_notices__notice_id__route_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/schedule-notices': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Inbox */
    get: operations['inbox_api_schedule_notices_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/schedule-notices/{notice_id}/read': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Mark Read */
    post: operations['mark_read_api_schedule_notices__notice_id__read_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/schedule-notices/read-all': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Read All */
    post: operations['read_all_api_schedule_notices_read_all_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/schedule-notices/refresh': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Refresh */
    post: operations['refresh_api_schedule_notices_refresh_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/serial-inventory': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Get Serial Inventory */
    get: operations['get_serial_inventory_api_serial_inventory_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/serial-inventory/batches': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Get Serial Inventory Batches */
    get: operations['get_serial_inventory_batches_api_serial_inventory_batches_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/serial-inventory/stock': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Get All Serial Stock */
    get: operations['get_all_serial_stock_api_serial_inventory_stock_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/serial-urgency': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Get Urgency */
    get: operations['get_urgency_api_serial_urgency_get']
    /** Set Urgency */
    put: operations['set_urgency_api_serial_urgency_put']
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/team-directory': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Team Directory */
    get: operations['team_directory_api_team_directory_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/team-materials/{team_id}/analytics': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Analytics Endpoint */
    get: operations['analytics_endpoint_api_team_materials__team_id__analytics_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/team-materials/{team_id}/dispatches': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** List Dispatches */
    get: operations['list_dispatches_api_team_materials__team_id__dispatches_get']
    put?: never
    /** Create Dispatch */
    post: operations['create_dispatch_api_team_materials__team_id__dispatches_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/team-materials/{team_id}/employees': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** List Employees */
    get: operations['list_employees_api_team_materials__team_id__employees_get']
    put?: never
    /** Create Employee */
    post: operations['create_employee_api_team_materials__team_id__employees_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/team-materials/{team_id}/employees/{employee_id}': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    /** Update Employee */
    patch: operations['update_employee_api_team_materials__team_id__employees__employee_id__patch']
    trace?: never
  }
  '/api/team-materials/{team_id}/inspection-problems': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** List Inspection Problems */
    get: operations['list_inspection_problems_api_team_materials__team_id__inspection_problems_get']
    put?: never
    /** Create Inspection Problem */
    post: operations['create_inspection_problem_api_team_materials__team_id__inspection_problems_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/team-materials/{team_id}/inspection-problems/{problem_id}': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    /** Update Inspection Problem */
    patch: operations['update_inspection_problem_api_team_materials__team_id__inspection_problems__problem_id__patch']
    trace?: never
  }
  '/api/team-materials/{team_id}/inventory': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Inventory Endpoint */
    get: operations['inventory_endpoint_api_team_materials__team_id__inventory_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/team-materials/{team_id}/inventory/{group_id}/movements': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Movements Endpoint */
    get: operations['movements_endpoint_api_team_materials__team_id__inventory__group_id__movements_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/team-materials/{team_id}/inventory/{group_id}/pending-outbound': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Pending Endpoint */
    get: operations['pending_endpoint_api_team_materials__team_id__inventory__group_id__pending_outbound_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/team-materials/{team_id}/inventory/{group_id}/shipment-stock': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Shipment Stock */
    get: operations['shipment_stock_api_team_materials__team_id__inventory__group_id__shipment_stock_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/team-materials/{team_id}/inventory/{group_id}/sources': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Sources Endpoint */
    get: operations['sources_endpoint_api_team_materials__team_id__inventory__group_id__sources_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/team-materials/{team_id}/losses': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** List Losses */
    get: operations['list_losses_api_team_materials__team_id__losses_get']
    put?: never
    /** Create Loss */
    post: operations['create_loss_api_team_materials__team_id__losses_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/team-materials/{team_id}/opening-stock': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** State */
    get: operations['state_api_team_materials__team_id__opening_stock_get']
    put?: never
    /** Create */
    post: operations['create_api_team_materials__team_id__opening_stock_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/team-materials/{team_id}/opening-stock/authorization': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    /** Authorize Opening */
    put: operations['authorize_opening_api_team_materials__team_id__opening_stock_authorization_put']
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/team-materials/{team_id}/outbound-batches': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** List Outbound Batches */
    get: operations['list_outbound_batches_api_team_materials__team_id__outbound_batches_get']
    put?: never
    /** Create Dispatch */
    post: operations['create_dispatch_api_team_materials__team_id__outbound_batches_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/team-materials/{team_id}/overview': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Overview */
    get: operations['overview_api_team_materials__team_id__overview_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/team-materials/{team_id}/processing-daily': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Processing Daily Report */
    get: operations['processing_daily_report_api_team_materials__team_id__processing_daily_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/team-materials/{team_id}/processing-records': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** List Processing Records */
    get: operations['list_processing_records_api_team_materials__team_id__processing_records_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/team-materials/{team_id}/processing-stock': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Processing Sources */
    get: operations['processing_sources_api_team_materials__team_id__processing_stock_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/team-materials/{team_id}/processing-tasks': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** List Processing Tasks */
    get: operations['list_processing_tasks_api_team_materials__team_id__processing_tasks_get']
    put?: never
    /** Create Processing Task */
    post: operations['create_processing_task_api_team_materials__team_id__processing_tasks_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/team-materials/{team_id}/processing-tasks/{task_id}': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    /** Update Processing Task */
    patch: operations['update_processing_task_api_team_materials__team_id__processing_tasks__task_id__patch']
    trace?: never
  }
  '/api/team-materials/{team_id}/purposes': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** List Purposes */
    get: operations['list_purposes_api_team_materials__team_id__purposes_get']
    put?: never
    /** Create Purpose */
    post: operations['create_purpose_api_team_materials__team_id__purposes_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/team-materials/{team_id}/purposes/{purpose_id}': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    /** Update Purpose */
    patch: operations['update_purpose_api_team_materials__team_id__purposes__purpose_id__patch']
    trace?: never
  }
  '/api/team-materials/{team_id}/quantity-adjustments': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Change Quantity */
    post: operations['change_quantity_api_team_materials__team_id__quantity_adjustments_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/team-materials/{team_id}/receipts': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** List Team Receipts */
    get: operations['list_team_receipts_api_team_materials__team_id__receipts_get']
    put?: never
    /** Create Warehouse Receipt */
    post: operations['create_warehouse_receipt_api_team_materials__team_id__receipts_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/team-materials/{team_id}/serial-history': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** History */
    get: operations['history_api_team_materials__team_id__serial_history_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/team-materials/{team_id}/serial-reallocations': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** List Serial Reallocations */
    get: operations['list_serial_reallocations_api_team_materials__team_id__serial_reallocations_get']
    put?: never
    /** Reallocate Serial */
    post: operations['reallocate_serial_api_team_materials__team_id__serial_reallocations_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/team-materials/{team_id}/serials': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Serials Endpoint */
    get: operations['serials_endpoint_api_team_materials__team_id__serials_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/team-materials/{team_id}/stock': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** List Stock */
    get: operations['list_stock_api_team_materials__team_id__stock_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/team-materials/{team_id}/stock/{lot_id}/quantity-adjustments': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Quantity Context */
    get: operations['quantity_context_api_team_materials__team_id__stock__lot_id__quantity_adjustments_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/team-materials/{team_id}/warehouse-locations': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Warehouse Locations */
    get: operations['warehouse_locations_api_team_materials__team_id__warehouse_locations_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/teams': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** List Teams */
    get: operations['list_teams_api_teams_get']
    put?: never
    /** Create Team */
    post: operations['create_team_api_teams_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/teams/{team_id}': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Get Team */
    get: operations['get_team_api_teams__team_id__get']
    put?: never
    post?: never
    /** Delete Team */
    delete: operations['delete_team_api_teams__team_id__delete']
    options?: never
    head?: never
    /** Update Team */
    patch: operations['update_team_api_teams__team_id__patch']
    trace?: never
  }
  '/api/teams/{team_id}/receipt-documents': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Upload Document */
    post: operations['upload_document_api_teams__team_id__receipt_documents_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/transfer-amendments/{amendment_id}': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Read Amendment */
    get: operations['read_amendment_api_transfer_amendments__amendment_id__get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/transfer-amendments/{amendment_id}/approve': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Approve */
    post: operations['approve_api_transfer_amendments__amendment_id__approve_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/transfer-amendments/{amendment_id}/cancel': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Cancel */
    post: operations['cancel_api_transfer_amendments__amendment_id__cancel_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/transfer-amendments/{amendment_id}/reject': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Reject */
    post: operations['reject_api_transfer_amendments__amendment_id__reject_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/users': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** List Users */
    get: operations['list_users_api_users_get']
    put?: never
    /** Create User */
    post: operations['create_user_api_users_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/users/{user_id}': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Get User */
    get: operations['get_user_api_users__user_id__get']
    put?: never
    post?: never
    /** Delete User */
    delete: operations['delete_user_api_users__user_id__delete']
    options?: never
    head?: never
    /** Update User */
    patch: operations['update_user_api_users__user_id__patch']
    trace?: never
  }
  '/api/warehouse-locations': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Catalog */
    get: operations['catalog_api_warehouse_locations_get']
    put?: never
    /** Create */
    post: operations['create_api_warehouse_locations_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/warehouse-locations/{location_id}': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    /** Edit */
    patch: operations['edit_api_warehouse_locations__location_id__patch']
    trace?: never
  }
  '/api/warehouse-locations/{location_id}/placement': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Assign */
    post: operations['assign_api_warehouse_locations__location_id__placement_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/warehouse-locations/{location_id}/reservation': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Claim */
    post: operations['claim_api_warehouse_locations__location_id__reservation_post']
    /** Unclaim */
    delete: operations['unclaim_api_warehouse_locations__location_id__reservation_delete']
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
}
export type webhooks = Record<string, never>
export interface components {
  schemas: {
    /** AccessStatusResponse */
    AccessStatusResponse: {
      /** Enabled */
      enabled: boolean
      /** Unlocked */
      unlocked: boolean
    }
    /** AdjustmentCreate */
    AdjustmentCreate: {
      /** Actual Temperature C */
      actual_temperature_c?: number | string | null
      /** Completed Quantity */
      completed_quantity?: number | null
      /** Completed Weight */
      completed_weight?: number | string | null
      /** Expected Revision */
      expected_revision: number
      /** Furnace No */
      furnace_no?: string | null
      /** Holding Minutes */
      holding_minutes?: number | null
      /** Idempotency Key */
      idempotency_key: string
      /** Input Quantity */
      input_quantity?: number | null
      /** Machine No */
      machine_no?: string | null
      /** Outputs */
      outputs?: components['schemas']['ProcessingOutput'][] | null
      /** Processing Date */
      processing_date?: string | null
      /** Processing Minutes */
      processing_minutes?: number | null
      /** Processing Mode */
      processing_mode?: ('unit' | 'split') | null
      /** Processing Status */
      processing_status?: ('partial' | 'complete') | null
      /** Processing Task Id */
      processing_task_id?: number | null
      /** Processor Employee Id */
      processor_employee_id?: number | null
      /** Processor Employee Ids */
      processor_employee_ids?: number[] | null
      /** Processor Name */
      processor_name: string
      /** Production Schedule Id */
      production_schedule_id?: number | null
      /** Purpose Id */
      purpose_id?: number | null
      /** Quantity */
      quantity: number
      /**
       * Reason
       * @default
       */
      reason: string
      /** Rework Of Id */
      rework_of_id?: number | null
      /** Source Transfer Id */
      source_transfer_id: number
      /** Temperature Requirement */
      temperature_requirement?: string | null
      /** Transfer Specification */
      transfer_specification?: string | null
      /**
       * Work Kind
       * @default initial
       * @enum {string}
       */
      work_kind: 'initial' | 'rework'
    }
    /** AmendmentCreate */
    AmendmentCreate: {
      /** Expected Version */
      expected_version: number
      /** Notes */
      notes?: string | null
      /** Quantity */
      quantity: number
      /** Reason */
      reason: string
      /** Weight */
      weight: number | string
    }
    /** AmendmentReject */
    AmendmentReject: {
      /** Reason */
      reason: string
    }
    /** AmendmentValuesResponse */
    AmendmentValuesResponse: {
      /** Notes */
      notes: string | null
      /** Quantity */
      quantity: number
      /** Weight */
      weight: number
    }
    /** AmountResponse */
    AmountResponse: {
      /** Quantity */
      quantity: number
      /** Weight */
      weight: number
    }
    /** AttentionSerialResponse */
    AttentionSerialResponse: {
      /** Age Days */
      age_days: number
      /** Materials */
      materials: string[]
      /** Overdue Days */
      overdue_days: number
      /** Reasons */
      reasons: string[]
      /** Remaining */
      remaining: number | null
      /** Serial No */
      serial_no: string
      /** Teams */
      teams: string[]
    }
    /** BatchPlanWrite */
    BatchPlanWrite: {
      /** Batches */
      batches: components['schemas']['BatchWrite'][]
      /** Expected Version */
      expected_version: number
    }
    /** BatchWrite */
    BatchWrite: {
      /** Batch Number */
      batch_number: number
      /**
       * Due At
       * Format: date-time
       */
      due_at: string
      /** Id */
      id?: number | null
      /** Planned Start At */
      planned_start_at?: string | null
      /** Target Quantity */
      target_quantity?: number | null
      /** Target Weight */
      target_weight?: number | string | null
      /** Upstream Batch Ids */
      upstream_batch_ids?: number[]
    }
    /** BindWrite */
    BindWrite: {
      /** Source Transfer Ids */
      source_transfer_ids: number[]
    }
    /** Body_attach_order_api_process_routes__route_id__order_post */
    Body_attach_order_api_process_routes__route_id__order_post: {
      /**
       * File
       * Format: binary
       */
      file: string
      /** Version */
      version: number
    }
    /** Body_attach_word_api_process_routes__route_id__source_post */
    Body_attach_word_api_process_routes__route_id__source_post: {
      /**
       * File
       * Format: binary
       */
      file: string
      /** Version */
      version: number
    }
    /** Body_create_draft_api_process_routes_post */
    Body_create_draft_api_process_routes_post: {
      /** Drawings */
      drawings: string[]
      /**
       * File
       * Format: binary
       */
      file: string
      /** Payload */
      payload: string
    }
    /** Body_create_task_api_production_schedules_tasks_post */
    Body_create_task_api_production_schedules_tasks_post: {
      /** File */
      file?: string | null
      /** Payload */
      payload: string
    }
    /** Body_import_word_api_process_routes_import_post */
    Body_import_word_api_process_routes_import_post: {
      /**
       * File
       * Format: binary
       */
      file: string
    }
    /** Body_parse_order_file_api_process_routes_parse_order_post */
    Body_parse_order_file_api_process_routes_parse_order_post: {
      /**
       * File
       * Format: binary
       */
      file: string
    }
    /** Body_parse_word_api_process_routes_parse_post */
    Body_parse_word_api_process_routes_parse_post: {
      /**
       * File
       * Format: binary
       */
      file: string
    }
    /** Body_preview_order_api_production_schedules_parse_order_post */
    Body_preview_order_api_production_schedules_parse_order_post: {
      /**
       * File
       * Format: binary
       */
      file: string
    }
    /** Body_preview_order_original_api_production_schedules_order_preview_post */
    Body_preview_order_original_api_production_schedules_order_preview_post: {
      /**
       * File
       * Format: binary
       */
      file: string
    }
    /** Body_preview_uploaded_drawing_api_process_routes_drawing_preview_post */
    Body_preview_uploaded_drawing_api_process_routes_drawing_preview_post: {
      /**
       * File
       * Format: binary
       */
      file: string
    }
    /** Body_upload_document_api_teams__team_id__receipt_documents_post */
    Body_upload_document_api_teams__team_id__receipt_documents_post: {
      /**
       * File
       * Format: binary
       */
      file: string
      /**
       * Kind
       * @enum {string}
       */
      kind: 'process' | 'drawing' | 'order'
    }
    /** Body_upload_drawing_api_process_routes__route_id__drawings_post */
    Body_upload_drawing_api_process_routes__route_id__drawings_post: {
      /**
       * File
       * Format: binary
       */
      file: string
      /** Version */
      version: number
    }
    /** BoundRouteResponse */
    BoundRouteResponse: {
      /** Bound */
      bound: number
      /** Route Id */
      route_id: number
    }
    /** BusinessNoticePageResponse */
    BusinessNoticePageResponse: {
      /** Items */
      items: components['schemas']['BusinessNoticeResponse'][]
      latest: components['schemas']['NoticeCursorsResponse']
      /** Total */
      total: number
      /** Unread */
      unread: number
    }
    /** BusinessNoticeReadAll */
    BusinessNoticeReadAll: {
      /**
       * Quality
       * @default 0
       */
      quality: number
      /** Rework */
      rework: number
      /** Schedule */
      schedule: number
      /**
       * Transfer
       * @default 0
       */
      transfer: number
    }
    /** BusinessNoticeResponse */
    BusinessNoticeResponse: {
      /** Action Required */
      action_required?: boolean | null
      /** Amendment Id */
      amendment_id?: number | null
      /** Amendment Status */
      amendment_status?: ('pending' | 'approved' | 'rejected' | 'cancelled') | null
      /** Batch No */
      batch_no: string | null
      /** Created At */
      created_at: string
      /** Id */
      id: number
      /** Kind */
      kind:
        | (
            | 'new'
            | 'changed'
            | 'cancelled'
            | 'upstream'
            | 'final_due'
            | 'due_soon'
            | 'overdue'
            | 'review'
            | 'returned'
            | 'locked'
            | 'unlocked'
          )
        | ('requested' | 'ready')
        | (
            | 'amendment_requested'
            | 'amendment_approved'
            | 'amendment_rejected'
            | 'amendment_cancelled'
          )
        | 'quality_reported'
      /** Message */
      message: string
      /** Read At */
      read_at: string | null
      /** Serial No */
      serial_no: string
      /**
       * Source
       * @enum {string}
       */
      source: 'schedule' | 'rework' | 'transfer' | 'quality'
      /** Team Name */
      team_name: string
    }
    /** BusinessPersonResponse */
    BusinessPersonResponse: {
      /** Active */
      active: boolean
      /** Id */
      id: number
      /** Name */
      name: string
      /** Version */
      version: number
    }
    /** BusinessPersonWrite */
    BusinessPersonWrite: {
      /**
       * Active
       * @default true
       */
      active: boolean
      /** Expected Version */
      expected_version?: number | null
      /** Name */
      name: string
    }
    /** ChartAmountResponse */
    ChartAmountResponse: {
      /** Key */
      key?: string | null
      /** Quantity */
      quantity: number
      /** Weight */
      weight: number
    }
    /** ChartPointResponse */
    ChartPointResponse: {
      /** Key */
      key: string
      /** Label */
      label?: string | null
      /** Quantity */
      quantity: number
      /** Weight */
      weight: number
    }
    /** ConfigurationSave */
    ConfigurationSave: {
      /** Base Url */
      base_url: string
      /** Enabled */
      enabled: boolean
      /** Expected Version */
      expected_version: number
      /** Timeout Seconds */
      timeout_seconds: number
      /**
       * Token
       * @default
       */
      token: string
    }
    /** ConfigurationTest */
    ConfigurationTest: {
      /** Expected Version */
      expected_version: number
      /** Serial No */
      serial_no: string
    }
    /** ConfigurationTestResponse */
    ConfigurationTestResponse: {
      data: components['schemas']['MainSystemLookupResponse'] | null
      /** Message */
      message: string
      /** Ok */
      ok: boolean
      /** Tested At */
      tested_at: string
    }
    /** CurrentStockResponse */
    CurrentStockResponse: {
      /** Processing */
      processing: components['schemas']['StockProcessingResponse'][]
      /** Serial Count */
      serial_count: number
      /** Unnumbered Batch Count */
      unnumbered_batch_count: number
    }
    /** CustomerBatch */
    CustomerBatch: {
      /** Batch Number */
      batch_number: number
      /**
       * Due At
       * Format: date-time
       */
      due_at: string
      /** Target Quantity */
      target_quantity: number
    }
    /** CustomerDeliveryBatchResponse */
    CustomerDeliveryBatchResponse: {
      /** Batch Number */
      batch_number: number
      /** Due At */
      due_at: string
      /** Target Quantity */
      target_quantity: number
    }
    /** DashboardDeliveryResponse */
    DashboardDeliveryResponse: {
      /** Due Count */
      due_count: number
      /** Items */
      items: components['schemas']['DeliveryResponse'][]
      /** On Time Rate */
      on_time_rate: number | null
      /** Overdue Count */
      overdue_count: number
      /** Total */
      total: number
      /** Upcoming Count */
      upcoming_count: number
    }
    /** DashboardSerialResponse */
    DashboardSerialResponse: {
      /** Created At */
      created_at: string
      /** Serial No */
      serial_no: string
    }
    /** DashboardStockDetailResponse */
    DashboardStockDetailResponse: {
      /** Material */
      material: string
      /** Material Type */
      material_type: string | null
      /** Processing Role */
      processing_role: ('remaining' | 'produced' | 'scrap') | null
      /** Quantity */
      quantity: number
      /** Serial No */
      serial_no: string
      /** Team Id */
      team_id: number
      /** Team Name */
      team_name: string
      /** Transfer Specification */
      transfer_specification: string | null
      /** Weight */
      weight: number
    }
    /** Decision */
    Decision: {
      /**
       * Disposition
       * @enum {string}
       */
      disposition: 'pending' | 'rework' | 'shipment' | 'transfer' | 'reallocate' | 'scrap' | 'other'
      /** Expected Version */
      expected_version: number
      /** Idempotency Key */
      idempotency_key: string
      /** Involved Team Ids */
      involved_team_ids: number[]
      /**
       * Notes
       * @default
       */
      notes: string
      /**
       * Release Legacy Hold
       * @default false
       */
      release_legacy_hold: boolean
      /**
       * Status
       * @enum {string}
       */
      status: 'pending' | 'processing' | 'closed'
    }
    /** DeliveryResponse */
    DeliveryResponse: {
      /** Completed On */
      completed_on: string | null
      /** Due Date */
      due_date: string
      /** Index */
      index: number
      /** Label */
      label: string
      /** Legacy */
      legacy: boolean
      /** Overdue Days */
      overdue_days: number
      /** Quantity */
      quantity: number
      /** Remaining */
      remaining: number
      /** Serial No */
      serial_no: string
      /** Shipped */
      shipped: number
      /** Source Batch No */
      source_batch_no: string | null
      /**
       * Status
       * @enum {string}
       */
      status: 'on_time' | 'late_complete' | 'overdue' | 'pending'
    }
    /** DirectoryItemInput */
    DirectoryItemInput: {
      /**
       * Active
       * @default true
       */
      active: boolean
      /** Expected Version */
      expected_version?: number | null
      /** Name */
      name: string
    }
    /** DispatchConfirm */
    DispatchConfirm: {
      /** Expected Revision */
      expected_revision: string
      /** Idempotency Key */
      idempotency_key: string
    }
    /** DispatchCreate */
    DispatchCreate: {
      /**
       * Entry Kind
       * @default transfer
       */
      entry_kind: string
      /** External Destination */
      external_destination?: string | null
      /** Idempotency Key */
      idempotency_key: string
      inventory_total?: components['schemas']['ShipmentTotal'] | null
      /** Lines */
      lines?: components['schemas']['DispatchLine'][]
      /** Next Team Id */
      next_team_id?: number | null
      /** Notes */
      notes?: string | null
      /** Quantity Adjustments */
      quantity_adjustments?: components['schemas']['ProcessingQuantity'][]
      /** Quantity Clearances */
      quantity_clearances?: components['schemas']['OutboundQuantityClearance'][]
      /**
       * Rework Return
       * @default false
       */
      rework_return: boolean
      /** Sent Employee Id */
      sent_employee_id: number
    }
    /** DispatchLine */
    DispatchLine: {
      /** Material Type */
      material_type?: string | null
      /** Process Route Id */
      process_route_id?: number | null
      /** Process Route Version */
      process_route_version?: number | null
      /** Production Schedule Batch Id */
      production_schedule_batch_id?: number | null
      /** Production Schedule Id */
      production_schedule_id?: number | null
      /** Purpose Id */
      purpose_id?: number | null
      /** Quantity */
      quantity: number
      /** Serial No */
      serial_no?: string | null
      /** Shared Serials */
      shared_serials?: components['schemas']['SharedMaterialSerial-Input'][] | null
      /** Sludge Content Percent */
      sludge_content_percent?: number | string | null
      /** Sludge Gross Weight */
      sludge_gross_weight?: number | string | null
      /** Source Transfer Id */
      source_transfer_id: number
      /** Transfer Specification */
      transfer_specification?: string | null
      /** Warehouse Location */
      warehouse_location?: string | null
      /** Warehouse Location Reservation Key */
      warehouse_location_reservation_key?: string | null
      /** Weight */
      weight: number | string
    }
    /** DispatchReceiptConfirm */
    DispatchReceiptConfirm: {
      /** Expected Revision */
      expected_revision: string
      /** Idempotency Key */
      idempotency_key: string
      /** Received Employee Id */
      received_employee_id: number
    }
    /** FactoryDashboardResponse */
    FactoryDashboardResponse: {
      /** As Of */
      as_of: string
      /** Attention */
      attention: components['schemas']['AttentionSerialResponse'][]
      delivery: components['schemas']['DashboardDeliveryResponse']
      /** Legacy Count */
      legacy_count: number
      /** Serial Count */
      serial_count: number
      shipping: components['schemas']['ShipmentsResponse']
      stock: components['schemas']['FactoryStockMatrixResponse']
      /** Today */
      today: string
      /** Yields */
      yields: components['schemas']['MaterialYieldResponse'][]
    }
    /** FactoryFlowsResponse */
    FactoryFlowsResponse: {
      inbound: components['schemas']['ChartAmountResponse']
      internal: components['schemas']['ChartAmountResponse']
      loss: components['schemas']['ChartAmountResponse']
      outbound: components['schemas']['ChartAmountResponse']
      shipment: components['schemas']['ChartAmountResponse']
    }
    /** FactoryInventoryGroupResponse */
    FactoryInventoryGroupResponse: {
      /** Adjusted Quantity */
      adjusted_quantity: number
      /** Adjusted Weight */
      adjusted_weight: number
      /** Available Quantity */
      available_quantity: number
      /** Available Weight */
      available_weight: number
      /** Batch Count */
      batch_count: number
      /** Current Batch Count */
      current_batch_count: number
      /** Customer Code */
      customer_code: string | null
      /** Customer Code Count */
      customer_code_count: number
      /** Dispatched Quantity */
      dispatched_quantity: number
      /** Dispatched Weight */
      dispatched_weight: number
      /** External Pending Quantity */
      external_pending_quantity: number
      /** External Pending Weight */
      external_pending_weight: number
      /** External Source */
      external_source: string
      /** Finished Quantity */
      finished_quantity: number | null
      /** Finished Quantity Count */
      finished_quantity_count: number
      /** Finished Specification */
      finished_specification: string | null
      /** Finished Specification Count */
      finished_specification_count: number
      /** Group Id */
      group_id: number
      /** In Transit Quantity */
      in_transit_quantity: number
      /** In Transit Weight */
      in_transit_weight: number
      /** Inspection Hold Count */
      inspection_hold_count: number
      /** Last Activity At */
      last_activity_at: string | null
      /** Lost Quantity */
      lost_quantity: number
      /** Lost Weight */
      lost_weight: number
      /** Material Name */
      material_name: string
      /** Material Type */
      material_type: string
      /** Max Weight Difference */
      max_weight_difference: number
      /** Oldest Received At */
      oldest_received_at: string | null
      /** On Hand Quantity */
      on_hand_quantity: number
      /** On Hand Weight */
      on_hand_weight: number
      /** Owned Quantity */
      owned_quantity: number
      /** Owned Weight */
      owned_weight: number
      process_route: components['schemas']['RouteExecutionContextResponse'] | null
      /** Process Route Id */
      process_route_id: number | null
      /** Process Step Complete */
      process_step_complete: boolean
      /** Process Step Index */
      process_step_index: number | null
      /** Processing Complete Batch Count */
      processing_complete_batch_count: number
      /**
       * Processing Group
       * @enum {string}
       */
      processing_group: 'unregistered' | 'registered' | 'partial' | 'complete'
      /** Processing Partial Batch Count */
      processing_partial_batch_count: number
      /** Processing Registered Batch Count */
      processing_registered_batch_count: number
      /** Processing Registered Quantity */
      processing_registered_quantity: number
      /** Processing Registered Weight */
      processing_registered_weight: number
      /** Processing Role */
      processing_role: ('remaining' | 'produced' | 'scrap') | null
      /**
       * Processing State
       * @enum {string}
       */
      processing_state:
        | 'not_required'
        | 'not_applicable'
        | 'rework'
        | 'mixed'
        | 'partial'
        | 'complete'
        | 'registered'
        | 'unregistered'
        | 'pending'
        | 'cleared'
      /** Processing Unregistered Batch Count */
      processing_unregistered_batch_count: number
      /** Processing Unregistered Quantity */
      processing_unregistered_quantity: number
      /** Processing Unregistered Weight */
      processing_unregistered_weight: number
      /** Product Code */
      product_code: string | null
      /** Product Code Count */
      product_code_count: number
      /** Purpose Id */
      purpose_id: number | null
      /** Purpose Name */
      purpose_name: string
      /**
       * Receipt Source
       * @enum {string}
       */
      receipt_source: 'external' | 'return' | 'internal' | 'opening' | 'processing' | 'rework'
      /** Received Quantity */
      received_quantity: number
      /** Received Weight */
      received_weight: number
      /** Reserved Quantity */
      reserved_quantity: number
      /** Reserved Weight */
      reserved_weight: number
      /** Rework Count */
      rework_count: number
      /** Rework Pending */
      rework_pending: boolean
      /** Rework Round */
      rework_round: number | null
      /** Rework Route Id */
      rework_route_id: number | null
      /** Rework Route Ready */
      rework_route_ready: boolean | null
      /** Scrap Available Quantity */
      scrap_available_quantity: number
      /** Scrap Available Weight */
      scrap_available_weight: number
      /** Scrap Quantity */
      scrap_quantity: number
      /** Scrap Weight */
      scrap_weight: number
      /** Serial No */
      serial_no: string
      /** Shared Group Id */
      shared_group_id: number | null
      /** Shared Origin Batch No */
      shared_origin_batch_no?: string | null
      /** Shared Serials */
      shared_serials?: components['schemas']['SharedSerialResponse'][] | null
      /** Shared Unallocated */
      shared_unallocated: boolean
      /** Shortage Quantity */
      shortage_quantity: number
      /** Shortage Weight */
      shortage_weight: number
      /** Source Batch No */
      source_batch_no: string | null
      /** Source Batch No Count */
      source_batch_no_count: number
      /** Source Name */
      source_name: string | null
      /** Source Team Id */
      source_team_id: number | null
      /** Stock Age Basis */
      stock_age_basis: 'received' | null
      /** Stock Age Hours */
      stock_age_hours: number | null
      /** Stock Age Started At */
      stock_age_started_at: string | null
      /** Team Code */
      team_code: string
      /** Team Id */
      team_id: number
      /** Team Name */
      team_name: string
      /** Transfer Specification */
      transfer_specification: string
      urgency: components['schemas']['UrgencyResponse']
      /** Weight Difference */
      weight_difference: number
    }
    /** FactoryInventoryPageResponse */
    FactoryInventoryPageResponse: {
      /** As Of */
      as_of: string
      /** Items */
      items: components['schemas']['FactoryInventoryGroupResponse'][]
      /** Page */
      page: number
      /** Page Size */
      page_size: number
      /** Total */
      total: number
    }
    /** FactoryOverviewResponse */
    FactoryOverviewResponse: {
      /** As Of */
      as_of: string
      /** Days */
      days: number
      /** Legacy Received Count */
      legacy_received_count: number
      material_ranking: components['schemas']['StockRankingResponse']
      /** Material Types */
      material_types: components['schemas']['ChartPointResponse'][]
      pending: components['schemas']['PendingAmountResponse']
      /** Pending Attention */
      pending_attention: components['schemas']['PendingAttentionResponse'][]
      period_totals: components['schemas']['FactoryFlowsResponse']
      /** Recent Batches */
      recent_batches: components['schemas']['FactoryRecentBatchResponse'][]
      serial_ranking: components['schemas']['StockRankingResponse']
      /** Stock Age */
      stock_age: components['schemas']['ChartPointResponse'][]
      /** Stock Attention */
      stock_attention: components['schemas']['StockAttentionResponse'][]
      stock_matrix: components['schemas']['FactoryStockMatrixResponse']
      /** Teams */
      teams: components['schemas']['FactoryTeamResponse'][]
      totals: components['schemas']['StockBalanceResponse']
      /** Trend */
      trend: components['schemas']['FactoryTrendResponse'][]
      /** Waiting Age */
      waiting_age: components['schemas']['FactoryWaitingAgeResponse'][]
    }
    /** FactoryPerformanceResponse */
    FactoryPerformanceResponse: {
      activity?: components['schemas']['ProductionActivityResponse'] | null
      /** Date From */
      date_from: string
      /** Date To */
      date_to: string
      /** Generated At */
      generated_at: string
      issues: components['schemas']['IssueReportResponse']
      /**
       * Period
       * @enum {string}
       */
      period: 'day' | 'week' | 'month'
      /** Period Dates */
      period_dates: string[]
      production: components['schemas']['ProductionReportResponse']
      quality: components['schemas']['QualityReportResponse']
      /** Teams */
      teams: components['schemas']['PerformanceTeamResponse'][]
    }
    /** FactoryRecentBatchResponse */
    FactoryRecentBatchResponse: {
      /** Batch No */
      batch_no: string
      /**
       * Entry Kind
       * @enum {string}
       */
      entry_kind:
        | 'transfer'
        | 'warehouse_receipt'
        | 'warehouse_outbound'
        | 'inspection_shipment'
        | 'opening_stock'
        | 'serial_reallocation'
        | 'rework_split'
      /** External Destination */
      external_destination: string | null
      /** Line Count */
      line_count: number
      /** Material Count */
      material_count: number
      /** Material Name */
      material_name: string | null
      /** Quantity */
      quantity: number
      /** Received At */
      received_at: string | null
      /** Serial Count */
      serial_count: number
      /** Source Id */
      source_id: number | null
      /** Source Name */
      source_name: string | null
      /**
       * Status
       * @enum {string}
       */
      status: 'pending' | 'received' | 'dispatched' | 'partial' | 'voided'
      /** Target Id */
      target_id: number | null
      /** Target Name */
      target_name: string | null
      /** Updated At */
      updated_at: string
      /** Urgent Serial Count */
      urgent_serial_count: number
      /** Waiting Since */
      waiting_since: string | null
      /** Weight */
      weight: number
    }
    /** FactoryStockMatrixResponse */
    FactoryStockMatrixResponse: {
      /** Materials */
      materials: components['schemas']['NamedAmountResponse'][]
      /** Rows */
      rows: components['schemas']['FactoryStockRowResponse'][]
      total: components['schemas']['AmountResponse']
    }
    /** FactoryStockRowResponse */
    FactoryStockRowResponse: {
      /** Active */
      active: boolean
      /** Amounts */
      amounts: {
        [key: string]: components['schemas']['AmountResponse']
      }
      /** Team Code */
      team_code: string
      /** Team Id */
      team_id: number | null
      /** Team Name */
      team_name: string
      total: components['schemas']['AmountResponse'] | null
    }
    /** FactoryTeamResponse */
    FactoryTeamResponse: {
      /** Active */
      active: boolean
      balance: components['schemas']['StockBalanceResponse'] | null
      /** Code */
      code: string
      /** Id */
      id: number | null
      /** Name */
      name: string
      pending_incoming: components['schemas']['PendingAmountResponse'] | null
      /** Processing */
      processing: components['schemas']['StockProcessingResponse'][] | null
      /** Serial Count */
      serial_count: number | null
      /** Urgent Serial Count */
      urgent_serial_count: number | null
    }
    /** FactoryTrendResponse */
    FactoryTrendResponse: {
      inbound: components['schemas']['ChartAmountResponse']
      internal: components['schemas']['ChartAmountResponse']
      /** Key */
      key: string
      loss: components['schemas']['ChartAmountResponse']
      outbound: components['schemas']['ChartAmountResponse']
      shipment: components['schemas']['ChartAmountResponse']
    }
    /** FactoryWaitingAgeResponse */
    FactoryWaitingAgeResponse: {
      external: components['schemas']['ChartAmountResponse']
      internal: components['schemas']['ChartAmountResponse']
      /** Key */
      key: string
      /** Label */
      label: string
    }
    /** FeedbackDecisionResponse */
    FeedbackDecisionResponse: {
      /** Disposition */
      disposition?:
        ('pending' | 'rework' | 'shipment' | 'transfer' | 'reallocate' | 'scrap' | 'other') | null
      /** Involved Team Ids */
      involved_team_ids?: number[] | null
      /** Previous Involved Team Ids */
      previous_involved_team_ids?: number[] | null
      /** Released Legacy Hold */
      released_legacy_hold?: boolean | null
      /** Status */
      status?: ('pending' | 'processing' | 'closed') | null
    }
    /** FeedbackEventResponse */
    FeedbackEventResponse: {
      /** Actor */
      actor: string
      details: components['schemas']['FeedbackDecisionResponse']
      /** Id */
      id: number
      /**
       * Kind
       * @enum {string}
       */
      kind: 'reply' | 'decision'
      /** Notes */
      notes: string
      /** Occurred At */
      occurred_at: string
      /** Team Id */
      team_id: number
      /** Team Name */
      team_name: string
    }
    /** FeedbackTeamResponse */
    FeedbackTeamResponse: {
      /** Name */
      name: string
      /** Replied */
      replied: boolean
      /** Team Id */
      team_id: number
    }
    /** FeedbackWrite */
    FeedbackWrite: {
      /** Expected Version */
      expected_version: number
      /** Idempotency Key */
      idempotency_key: string
      /**
       * Notes
       * @default
       */
      notes: string
    }
    /** GroupQualityResponse */
    GroupQualityResponse: {
      /** Checked Quantity */
      checked_quantity: number
      /** Failed Quantity */
      failed_quantity: number
      /**
       * Kind
       * @enum {string}
       */
      kind: 'patrol' | 'inspection'
      /** Material Name */
      material_name: string | null
      /** Pass Rate */
      pass_rate: number | null
      /** Passed Quantity */
      passed_quantity: number
      /**
       * Phase
       * @enum {string}
       */
      phase: 'first' | 'recheck'
      /** Record Count */
      record_count: number
      /**
       * Scope
       * @enum {string}
       */
      scope: 'sample' | 'full'
      /** Team Id */
      team_id: number
      /** Team Name */
      team_name: string
    }
    /** HealthResponse */
    HealthResponse: {
      /** Database */
      database: string
      /** Status */
      status: string
    }
    /** HTTPValidationError */
    HTTPValidationError: {
      /** Detail */
      detail?: components['schemas']['ValidationError'][]
    }
    /** InspectionCreate */
    InspectionCreate: {
      /**
       * Checked At
       * Format: date-time
       */
      checked_at: string
      /**
       * Dimension Result
       * @default
       */
      dimension_result: string
      /** Expected Revision */
      expected_revision: number
      /** Failed Quantity */
      failed_quantity: number
      /** Idempotency Key */
      idempotency_key: string
      /** Inspector Employee Id */
      inspector_employee_id: number
      /** Involved Team Ids */
      involved_team_ids?: number[]
      /** Items */
      items: ('appearance' | 'dimension' | 'weight')[]
      /**
       * Kind
       * @default patrol
       * @enum {string}
       */
      kind: 'patrol' | 'inspection'
      /** Methods */
      methods: ('visual' | 'microscope')[]
      /**
       * Notes
       * @default
       */
      notes: string
      /** Parent Id */
      parent_id?: number | null
      /** Problem Type Ids */
      problem_type_ids?: number[]
      /** Sample Quantity */
      sample_quantity: number
      /**
       * Scope
       * @default sample
       * @enum {string}
       */
      scope: 'sample' | 'full'
      /** Source Transfer Id */
      source_transfer_id: number
      /**
       * Weight Result
       * @default
       */
      weight_result: string
    }
    /** InspectionProblemResponse */
    InspectionProblemResponse: {
      /** Id */
      id: number
      /** Name */
      name: string
    }
    /** InspectionRecordResponse */
    InspectionRecordResponse: {
      /** Batch No */
      batch_no: string
      /** Batch Quantity */
      batch_quantity: number
      /** Blocks Outbound */
      blocks_outbound: boolean
      /** Checked At */
      checked_at: string
      /** Created By */
      created_by: string
      /** Decision Notes */
      decision_notes: string
      /** Dimension Result */
      dimension_result: string
      /**
       * Disposition
       * @enum {string}
       */
      disposition: 'pending' | 'rework' | 'shipment' | 'transfer' | 'reallocate' | 'scrap' | 'other'
      /** Failed Quantity */
      failed_quantity: number
      /**
       * Feedback Status
       * @enum {string}
       */
      feedback_status: 'pending' | 'processing' | 'closed'
      /** Feedback Version */
      feedback_version: number
      /** Id */
      id: number
      /** Inspector Employee Id */
      inspector_employee_id: number
      /** Inspector Name */
      inspector_name: string
      /** Items */
      items: ('appearance' | 'dimension' | 'weight')[]
      /**
       * Kind
       * @enum {string}
       */
      kind: 'patrol' | 'inspection'
      /** Material Name */
      material_name: string | null
      /** Methods */
      methods: ('visual' | 'microscope')[]
      /** Notes */
      notes: string
      /** Parent Id */
      parent_id: number | null
      /** Passed Quantity */
      passed_quantity: number
      /** Problems */
      problems: components['schemas']['InspectionProblemResponse'][]
      process_step: components['schemas']['RouteExecutionContextResponse'] | null
      /** Processing Record Id */
      processing_record_id: number | null
      /** Processor Name */
      processor_name: string | null
      /** Quality Issue Id */
      quality_issue_id: number | null
      /** Released At */
      released_at: string | null
      /** Sample Quantity */
      sample_quantity: number
      /**
       * Scope
       * @enum {string}
       */
      scope: 'sample' | 'full'
      /** Serial No */
      serial_no: string
      /** Source Transfer Id */
      source_transfer_id: number
      /** Specification */
      specification: string | null
      /**
       * Status
       * @enum {string}
       */
      status: 'pending' | 'released' | 'passed' | 'failed'
      /** Team Id */
      team_id: number
      /** Team Name */
      team_name: string
      /** Weight Result */
      weight_result: string
    }
    /** InspectionSourceResponse */
    InspectionSourceResponse: {
      /** Batch No */
      batch_no: string
      /** Hold Id */
      hold_id: number | null
      /** Material Name */
      material_name: string | null
      /** Processing Status */
      processing_status: string | null
      /** Quantity */
      quantity: number
      /** Revision */
      revision: number
      /** Serial No */
      serial_no: string
      /** Source Transfer Id */
      source_transfer_id: number
      /** Specification */
      specification: string | null
      /** Team Id */
      team_id: number
    }
    /** InstallmentResponse */
    InstallmentResponse: {
      /** Due Date */
      due_date: string
      /** Label */
      label: string
      /** Quantity */
      quantity: number
    }
    /** InventoryGroupResponse */
    InventoryGroupResponse: {
      /** Adjusted Quantity */
      adjusted_quantity: number
      /** Adjusted Weight */
      adjusted_weight: number
      /** Available Quantity */
      available_quantity: number
      /** Available Weight */
      available_weight: number
      /** Batch Count */
      batch_count: number
      /** Current Batch Count */
      current_batch_count: number
      /** Customer Code */
      customer_code: string | null
      /** Customer Code Count */
      customer_code_count: number
      /** Dispatched Quantity */
      dispatched_quantity: number
      /** Dispatched Weight */
      dispatched_weight: number
      /** External Pending Quantity */
      external_pending_quantity: number
      /** External Pending Weight */
      external_pending_weight: number
      /** External Source */
      external_source: string
      /** Finished Quantity */
      finished_quantity: number | null
      /** Finished Quantity Count */
      finished_quantity_count: number
      /** Finished Specification */
      finished_specification: string | null
      /** Finished Specification Count */
      finished_specification_count: number
      /** Group Id */
      group_id: number
      /** In Transit Quantity */
      in_transit_quantity: number
      /** In Transit Weight */
      in_transit_weight: number
      /** Inspection Hold Count */
      inspection_hold_count: number
      /** Last Activity At */
      last_activity_at: string | null
      /** Lost Quantity */
      lost_quantity: number
      /** Lost Weight */
      lost_weight: number
      /** Material Name */
      material_name: string
      /** Material Type */
      material_type: string
      /** Max Weight Difference */
      max_weight_difference: number
      /** Oldest Received At */
      oldest_received_at: string | null
      /** On Hand Quantity */
      on_hand_quantity: number
      /** On Hand Weight */
      on_hand_weight: number
      /** Owned Quantity */
      owned_quantity: number
      /** Owned Weight */
      owned_weight: number
      process_route: components['schemas']['RouteExecutionContextResponse'] | null
      /** Process Route Id */
      process_route_id: number | null
      /** Process Step Complete */
      process_step_complete: boolean
      /** Process Step Index */
      process_step_index: number | null
      /** Processing Complete Batch Count */
      processing_complete_batch_count: number
      /**
       * Processing Group
       * @enum {string}
       */
      processing_group: 'unregistered' | 'registered' | 'partial' | 'complete'
      /** Processing Partial Batch Count */
      processing_partial_batch_count: number
      /** Processing Registered Batch Count */
      processing_registered_batch_count: number
      /** Processing Registered Quantity */
      processing_registered_quantity: number
      /** Processing Registered Weight */
      processing_registered_weight: number
      /** Processing Role */
      processing_role: ('remaining' | 'produced' | 'scrap') | null
      /**
       * Processing State
       * @enum {string}
       */
      processing_state:
        | 'not_required'
        | 'not_applicable'
        | 'rework'
        | 'mixed'
        | 'partial'
        | 'complete'
        | 'registered'
        | 'unregistered'
        | 'pending'
        | 'cleared'
      /** Processing Unregistered Batch Count */
      processing_unregistered_batch_count: number
      /** Processing Unregistered Quantity */
      processing_unregistered_quantity: number
      /** Processing Unregistered Weight */
      processing_unregistered_weight: number
      /** Product Code */
      product_code: string | null
      /** Product Code Count */
      product_code_count: number
      /** Purpose Id */
      purpose_id: number | null
      /** Purpose Name */
      purpose_name: string
      /**
       * Receipt Source
       * @enum {string}
       */
      receipt_source: 'external' | 'return' | 'internal' | 'opening' | 'processing' | 'rework'
      /** Received Quantity */
      received_quantity: number
      /** Received Weight */
      received_weight: number
      /** Reserved Quantity */
      reserved_quantity: number
      /** Reserved Weight */
      reserved_weight: number
      /** Rework Count */
      rework_count: number
      /** Rework Pending */
      rework_pending: boolean
      /** Rework Round */
      rework_round: number | null
      /** Rework Route Id */
      rework_route_id: number | null
      /** Rework Route Ready */
      rework_route_ready: boolean | null
      /** Scrap Available Quantity */
      scrap_available_quantity: number
      /** Scrap Available Weight */
      scrap_available_weight: number
      /** Scrap Quantity */
      scrap_quantity: number
      /** Scrap Weight */
      scrap_weight: number
      /** Serial No */
      serial_no: string
      /** Shared Group Id */
      shared_group_id: number | null
      /** Shared Origin Batch No */
      shared_origin_batch_no?: string | null
      /** Shared Serials */
      shared_serials?: components['schemas']['SharedSerialResponse'][] | null
      /** Shared Unallocated */
      shared_unallocated: boolean
      /** Shortage Quantity */
      shortage_quantity: number
      /** Shortage Weight */
      shortage_weight: number
      /** Source Batch No */
      source_batch_no: string | null
      /** Source Batch No Count */
      source_batch_no_count: number
      /** Source Name */
      source_name: string | null
      /** Source Team Id */
      source_team_id: number | null
      /** Stock Age Basis */
      stock_age_basis: 'received' | null
      /** Stock Age Hours */
      stock_age_hours: number | null
      /** Stock Age Started At */
      stock_age_started_at: string | null
      /** Transfer Specification */
      transfer_specification: string
      urgency: components['schemas']['UrgencyResponse']
      /** Weight Difference */
      weight_difference: number
    }
    /** InventoryGroupSchedulesResponse */
    InventoryGroupSchedulesResponse: {
      /** Applicable */
      applicable: boolean
      /** Count */
      count: number
      /** Due At */
      due_at: string | null
      /** Group Id */
      group_id: number
      /** Items */
      items: components['schemas']['ScheduleResponse'][]
      /** Items Truncated */
      items_truncated: boolean
      /** Overdue Count */
      overdue_count: number
      /** Status */
      status:
        | (
            | 'pending'
            | 'today'
            | 'overdue'
            | 'completed'
            | 'completed_late'
            | 'cancelled'
            | 'not_assessed'
          )
        | ('unplanned' | 'not_applicable')
    }
    /** InventorySchedulesResponse */
    InventorySchedulesResponse: {
      /** Groups */
      groups: components['schemas']['InventoryGroupSchedulesResponse'][]
      /** Sources */
      sources: components['schemas']['InventorySourceSchedulesResponse'][]
    }
    /** InventorySourceSchedulesResponse */
    InventorySourceSchedulesResponse: {
      /** Applicable */
      applicable: boolean
      /** Count */
      count: number
      /** Due At */
      due_at: string | null
      /** Items */
      items: components['schemas']['ScheduleResponse'][]
      /** Items Truncated */
      items_truncated: boolean
      /** Overdue Count */
      overdue_count: number
      /** Source Transfer Id */
      source_transfer_id: number
      /** Status */
      status:
        | (
            | 'pending'
            | 'today'
            | 'overdue'
            | 'completed'
            | 'completed_late'
            | 'cancelled'
            | 'not_assessed'
          )
        | ('unplanned' | 'not_applicable')
    }
    /** IssueReportResponse */
    IssueReportResponse: {
      /** Problems */
      problems: components['schemas']['ProblemFrequencyResponse'][]
      summary: components['schemas']['IssueSummaryResponse']
      /** Teams */
      teams: components['schemas']['TeamIssueResponse'][]
      /** Trend */
      trend: components['schemas']['IssueTrendResponse'][]
    }
    /** IssueSummaryResponse */
    IssueSummaryResponse: {
      /** Closed */
      closed: number
      /** Pending */
      pending: number
      /** Processing */
      processing: number
      /** Total */
      total: number
      /** Unresolved */
      unresolved: number
    }
    /** IssueTrendResponse */
    IssueTrendResponse: {
      /** Date */
      date: string
      /** Total */
      total: number
      /** Unresolved */
      unresolved: number
    }
    JsonValue: unknown
    /** LeaseRequest */
    LeaseRequest: {
      /** Key */
      key: string
      /** Material Name */
      material_name?: string | null
      /** Material Type */
      material_type?: string | null
      /** Serial No */
      serial_no?: string | null
    }
    /** LegacyDeliveryPlanResponse */
    LegacyDeliveryPlanResponse: {
      /** Installments */
      installments: components['schemas']['InstallmentResponse'][]
      /** Serial No */
      serial_no: string
      /** Version */
      version: number
    }
    /** LocationWrite */
    LocationWrite: {
      /**
       * Active
       * @default true
       */
      active: boolean
      /** Expected Version */
      expected_version?: number | null
      /** Name */
      name: string
    }
    /** LoginRequest */
    LoginRequest: {
      /** Password */
      password: string
      /** Username */
      username: string
    }
    /** LoginResponse */
    LoginResponse: {
      /** Access Token */
      access_token: string
      /**
       * Expires At
       * Format: date-time
       */
      expires_at: string
      /** Token Type */
      token_type: string
      user: components['schemas']['UserResponse']
    }
    /** LossCreate */
    LossCreate: {
      /** Idempotency Key */
      idempotency_key: string
      /** Quantity */
      quantity: number
      /**
       * Reason
       * @default
       */
      reason: string
      /** Source Transfer Id */
      source_transfer_id: number
      /** Weight */
      weight: number | string
    }
    /** LotRouteResponse */
    LotRouteResponse: {
      current: components['schemas']['RouteExecutionContextResponse'] | null
      route: components['schemas']['ProcessRouteDetailResponse'] | null
    }
    /** MainSystemConfigurationResponse */
    MainSystemConfigurationResponse: {
      /** Allowed Origins */
      allowed_origins: string[]
      /** Base Url */
      base_url: string
      /** Enabled */
      enabled: boolean
      /** Has Token */
      has_token: boolean
      /** Key Ready */
      key_ready: boolean
      /** Last Test At */
      last_test_at: string | null
      /** Last Test Message */
      last_test_message: string | null
      /** Last Test Ok */
      last_test_ok: boolean | null
      /**
       * Source
       * @enum {string}
       */
      source: 'database' | 'environment'
      /** Timeout Seconds */
      timeout_seconds: number
      /** Updated At */
      updated_at: string | null
      /** Updated By */
      updated_by: string | null
      /** Version */
      version: number
    }
    /** MainSystemDocument */
    MainSystemDocument: {
      /** Category Level3 */
      category_level3: string | null
      /** Customer Code */
      customer_code: string | null
      /** Finished Quantity */
      finished_quantity: number | null
      /** Finished Specification */
      finished_specification: string | null
      /** Material Description */
      material_description: string | null
      /** Material Name */
      material_name: string
      /** Material Shape */
      material_shape: string | null
      /** Material Type */
      material_type: string | null
      /** Order Category */
      order_category: string | null
      /** Outsourced Unit */
      outsourced_unit: string | null
      /** Part No */
      part_no: string | null
      /** Product Code */
      product_code: string | null
      /** Purpose Category */
      purpose_category: string | null
      /** Source Batch No */
      source_batch_no: string | null
      /** Special Process */
      special_process: string | null
      /** Technical Requirements */
      technical_requirements: string | null
      /** Transfer Specification */
      transfer_specification: string | null
    }
    /** MainSystemLookup */
    MainSystemLookup: {
      /** Active */
      active: boolean
      document: components['schemas']['MainSystemDocument']
      /** Revision */
      revision: string
      /**
       * Schema Version
       * @constant
       */
      schema_version: '1.0'
      /** Serial No */
      serial_no: string
      /** Snapshot Hash */
      snapshot_hash: string
      /**
       * Updated At
       * Format: date-time
       */
      updated_at: string
    }
    /** MainSystemLookupResponse */
    MainSystemLookupResponse: {
      /** Active */
      active: boolean
      document: components['schemas']['MainSystemDocument']
      /** Revision */
      revision: string
      /**
       * Schema Version
       * @constant
       */
      schema_version: '1.0'
      /** Serial No */
      serial_no: string
      /** Snapshot Hash */
      snapshot_hash: string
      /** Updated At */
      updated_at: string
    }
    /** MainSystemReceiptCreate */
    MainSystemReceiptCreate: {
      /** Expected Snapshot Hash */
      expected_snapshot_hash: string
      /** Idempotency Key */
      idempotency_key: string
      /** Material Type */
      material_type: string
      /**
       * Notes
       * @default
       */
      notes: string
      /** Quantity */
      quantity: number
      /** Serial No */
      serial_no: string
      /** Sludge Content Percent */
      sludge_content_percent?: number | string | null
      /** Sludge Gross Weight */
      sludge_gross_weight?: number | string | null
      /** Weight */
      weight: number | string
    }
    /** MaterialAnalyticsResponse */
    MaterialAnalyticsResponse: {
      /** As Of */
      as_of: string
      /**
       * Days
       * @enum {integer}
       */
      days: 7 | 30
      /** Loss Ranking */
      loss_ranking: components['schemas']['ChartPointResponse'][]
      /** Material Types */
      material_types: components['schemas']['ChartPointResponse'][]
      /** Materials */
      materials: components['schemas']['ChartPointResponse'][]
      /**
       * Metric
       * @enum {string}
       */
      metric: 'quantity' | 'weight'
      peers: components['schemas']['TeamPeersResponse']
      /** Stock Age */
      stock_age: components['schemas']['ChartPointResponse'][]
      /** Stock Ranking */
      stock_ranking: components['schemas']['ChartPointResponse'][]
      /** Team Id */
      team_id: number
      /** Trend */
      trend: components['schemas']['TeamTrendResponse'][]
      /** Waiting Age */
      waiting_age: components['schemas']['TeamWaitingAgeResponse'][]
    }
    /** MaterialBalanceResponse */
    MaterialBalanceResponse: {
      /** Adjusted Quantity */
      adjusted_quantity: number
      /** Adjusted Weight */
      adjusted_weight: number
      /** Available Quantity */
      available_quantity: number
      /** Available Weight */
      available_weight: number
      /** Dispatched Quantity */
      dispatched_quantity: number
      /** Dispatched Weight */
      dispatched_weight: number
      /** External Pending Quantity */
      external_pending_quantity: number
      /** External Pending Weight */
      external_pending_weight: number
      /** In Transit Quantity */
      in_transit_quantity: number
      /** In Transit Weight */
      in_transit_weight: number
      /** Lost Quantity */
      lost_quantity: number
      /** Lost Weight */
      lost_weight: number
      /** Material Name */
      material_name: string | null
      /** On Hand Quantity */
      on_hand_quantity: number
      /** On Hand Weight */
      on_hand_weight: number
      /** Owned Quantity */
      owned_quantity: number
      /** Owned Weight */
      owned_weight: number
      /** Received Quantity */
      received_quantity: number
      /** Received Weight */
      received_weight: number
      /** Reserved Quantity */
      reserved_quantity: number
      /** Reserved Weight */
      reserved_weight: number
      /** Scrap Available Quantity */
      scrap_available_quantity: number
      /** Scrap Available Weight */
      scrap_available_weight: number
      /** Scrap Quantity */
      scrap_quantity: number
      /** Scrap Weight */
      scrap_weight: number
      /** Shortage Quantity */
      shortage_quantity: number
      /** Shortage Weight */
      shortage_weight: number
    }
    /** MaterialBatchesResponse */
    MaterialBatchesResponse: {
      /** Items */
      items: components['schemas']['MaterialTransferResponse'][]
    }
    /** MaterialConfirmationResponse */
    MaterialConfirmationResponse: {
      /** At */
      at: string
      /** By */
      by: string
      /** Fingerprint */
      fingerprint: string
    }
    /** MaterialDeliveryUpdate */
    MaterialDeliveryUpdate: {
      /** Delivery Date */
      delivery_date: string | null
      /** Delivery Quantity */
      delivery_quantity: number | null
      /** Expected Version */
      expected_version: number
    }
    /** MaterialDispatchResponse */
    MaterialDispatchResponse: {
      /** Allowed Actions */
      allowed_actions: ('confirm' | 'confirm_outbound')[]
      /** Barcode Payload */
      barcode_payload: string
      /**
       * Barcode Type
       * @constant
       */
      barcode_type: 'CODE128'
      /** Confirmed At */
      confirmed_at: string | null
      /** Confirmed By */
      confirmed_by: string | null
      /** Confirmed By User Id */
      confirmed_by_user_id: number | null
      /**
       * Created At
       * Format: date-time
       */
      created_at: string
      /** Created By */
      created_by: string
      /** Dispatch No */
      dispatch_no: string
      /**
       * Entry Kind
       * @enum {string}
       */
      entry_kind: 'transfer' | 'warehouse_outbound' | 'inspection_shipment'
      /** External Destination */
      external_destination: string | null
      /** Id */
      id: number
      /** Items */
      items: components['schemas']['MaterialTransferResponse'][]
      /** Line Count */
      line_count: number
      /** Locked */
      locked: boolean
      next_team: components['schemas']['MaterialTransferTeamSnapshot'] | null
      /** Notes */
      notes: string | null
      /** Pending Line Count */
      pending_line_count: number
      /** Revision */
      revision: string
      source_team: components['schemas']['MaterialTransferTeamSnapshot'] | null
      /** Source Team Id */
      source_team_id: number
      /**
       * Status
       * @enum {string}
       */
      status: 'pending' | 'partial' | 'received' | 'voided' | 'dispatched'
      /** Total Quantity */
      total_quantity: number
      /** Total Weight */
      total_weight: number
    }
    /** MaterialDispatchSummaryResponse */
    MaterialDispatchSummaryResponse: {
      /**
       * Created At
       * Format: date-time
       */
      created_at: string
      /** Created By */
      created_by: string
      /** Dispatch No */
      dispatch_no: string
      /**
       * Entry Kind
       * @enum {string}
       */
      entry_kind: 'transfer' | 'warehouse_outbound' | 'inspection_shipment'
      /** External Destination */
      external_destination: string | null
      /** Items */
      items: components['schemas']['MaterialTransferResponse'][]
      /** Line Count */
      line_count: number
      next_team: components['schemas']['MaterialTransferTeamSnapshot'] | null
      /** Notes */
      notes: string | null
      /** Source Team Id */
      source_team_id: number
      /**
       * Status
       * @enum {string}
       */
      status: 'pending' | 'partial' | 'received' | 'voided' | 'dispatched'
      /** Total Quantity */
      total_quantity: number
      /** Total Weight */
      total_weight: number
    }
    /** MaterialLossResponse */
    MaterialLossResponse: {
      /** Batch No */
      batch_no: string
      /**
       * Created At
       * Format: date-time
       */
      created_at: string
      /** Created By */
      created_by: string
      /** Id */
      id: number
      /** Loss No */
      loss_no: string
      /** Material Name */
      material_name: string | null
      /** Quantity */
      quantity: number
      /** Reason */
      reason: string
      /** Serial No */
      serial_no: string | null
      /** Source Transfer Id */
      source_transfer_id: number
      /** Team Id */
      team_id: number
      urgency: components['schemas']['UrgencyResponse']
      /** Weight */
      weight: number
    }
    /** MaterialQualityResponse */
    MaterialQualityResponse: {
      /** Checked Quantity */
      checked_quantity: number
      /** Failed Quantity */
      failed_quantity: number
      /**
       * Kind
       * @enum {string}
       */
      kind: 'patrol' | 'inspection'
      /** Material Name */
      material_name: string | null
      /** Pass Rate */
      pass_rate: number | null
      /** Passed Quantity */
      passed_quantity: number
      /**
       * Phase
       * @enum {string}
       */
      phase: 'first' | 'recheck'
      /** Record Count */
      record_count: number
      /**
       * Scope
       * @enum {string}
       */
      scope: 'sample' | 'full'
    }
    /** MaterialReceiptConfirm */
    MaterialReceiptConfirm: {
      /** Expected Version */
      expected_version?: number | null
      /** Idempotency Key */
      idempotency_key: string
      /** Received Employee Id */
      received_employee_id: number
      /** Warehouse Location */
      warehouse_location?: string | null
      /** Warehouse Location Reservation Key */
      warehouse_location_reservation_key?: string | null
    }
    /** MaterialSuggestionDetailsResponse */
    MaterialSuggestionDetailsResponse: {
      /** Customer Code */
      customer_code?: string | null
      /** Finished Specification */
      finished_specification?: string | null
      /** Material Name */
      material_name?: string | null
      /** Part No */
      part_no?: string | null
      /** Product Code */
      product_code?: string | null
      /** Technical Requirements */
      technical_requirements?: string | null
    }
    /** MaterialSuggestionResponse */
    MaterialSuggestionResponse: {
      details: components['schemas']['MaterialSuggestionDetailsResponse']
      /** Source Batch No */
      source_batch_no: string
      /** Value */
      value: string
    }
    /** MaterialSuggestionsResponse */
    MaterialSuggestionsResponse: {
      /** Items */
      items: components['schemas']['MaterialSuggestionResponse'][]
    }
    /** MaterialTraceResponse */
    MaterialTraceResponse: {
      /** Focus Batch Id */
      focus_batch_id: number | null
      /** Holdings */
      holdings: components['schemas']['TraceHoldingResponse'][]
      /** Items */
      items: components['schemas']['TraceBatchResponse'][]
      /** Max Weight Difference */
      max_weight_difference: number
      /** Observed At */
      observed_at: string
      /** Positions */
      positions: components['schemas']['TracePositionResponse'][]
      /** Process Routes */
      process_routes: components['schemas']['TraceRouteResponse'][]
      /** Processing Delta Weight */
      processing_delta_weight: number
      /** Processing Records */
      processing_records: components['schemas']['QuantityAdjustmentResponse'][]
      /**
       * Query Kind
       * @enum {string}
       */
      query_kind: 'serial' | 'batch' | 'shared'
      /** Reallocations */
      reallocations: components['schemas']['MaterialTransferResponse'][]
      /** Serial No */
      serial_no: string
      /** Shared Group View */
      shared_group_view: boolean
      /** Shared Positions */
      shared_positions: components['schemas']['TraceSharedPositionResponse'][]
      shared_totals: components['schemas']['TraceTotalsResponse']
      shortage: components['schemas']['AmountResponse']
      totals: components['schemas']['TraceTotalsResponse']
      /** Untracked Count */
      untracked_count: number
      /** Weight Difference */
      weight_difference: number
    }
    /** MaterialTransferAmounts */
    MaterialTransferAmounts: {
      /** Quantity */
      quantity: number
      /** Weight */
      weight: number
    }
    /** MaterialTransferConfirm */
    MaterialTransferConfirm: {
      /** Expected Version */
      expected_version?: number | null
      /** Idempotency Key */
      idempotency_key: string
      /** Warehouse Location */
      warehouse_location?: string | null
      /** Warehouse Location Reservation Key */
      warehouse_location_reservation_key?: string | null
    }
    /** MaterialTransferCreate */
    MaterialTransferCreate: {
      /** Category Level3 */
      category_level3?: string | null
      /** Customer Code */
      customer_code?: string | null
      /** Delivery Date */
      delivery_date?: string | null
      /** Delivery Quantity */
      delivery_quantity?: number | null
      /** Finished Quantity */
      finished_quantity?: number | null
      /** Finished Specification */
      finished_specification?: string | null
      /** Idempotency Key */
      idempotency_key?: string | null
      /** Material Description */
      material_description?: string | null
      /** Material Name */
      material_name?: string | null
      /** Material Shape */
      material_shape?: string | null
      /** Material Type */
      material_type?: string | null
      /** Next Team Id */
      next_team_id: number
      /** Notes */
      notes?: string | null
      /** Order Category */
      order_category?: string | null
      /** Outsourced Unit */
      outsourced_unit?: string | null
      /** Part No */
      part_no?: string | null
      /** Product Code */
      product_code?: string | null
      /** Purpose Category */
      purpose_category?: string | null
      /** Purpose Id */
      purpose_id?: number | null
      /** Quantity */
      quantity: number
      /** Sent Employee Id */
      sent_employee_id: number
      /** Serial No */
      serial_no: string
      /** Sludge Content Percent */
      sludge_content_percent?: number | string | null
      /** Sludge Gross Weight */
      sludge_gross_weight?: number | string | null
      /** Source Batch No */
      source_batch_no?: string | null
      /** Special Process */
      special_process?: string | null
      /** Technical Requirements */
      technical_requirements?: string | null
      /** Transfer Specification */
      transfer_specification?: string | null
      /** Warehouse Location */
      warehouse_location?: string | null
      /** Warehouse Location Reservation Key */
      warehouse_location_reservation_key?: string | null
      /** Weight */
      weight: number | string
    }
    /** MaterialTransferEventResponse */
    MaterialTransferEventResponse: {
      /** Action */
      action: string
      /** Actor */
      actor: string
      /** Changes */
      changes: {
        [key: string]: {
          [key: string]: unknown
        }
      }
      /** Id */
      id: number
      /**
       * Occurred At
       * Format: date-time
       */
      occurred_at: string
    }
    /** MaterialTransferList */
    MaterialTransferList: {
      /** Items */
      items: components['schemas']['MaterialTransferResponse'][]
      /** Page */
      page: number
      /** Page Size */
      page_size: number
      summary?: components['schemas']['MaterialTransferSummary'] | null
      /** Total */
      total: number
    }
    /** MaterialTransferReject */
    MaterialTransferReject: {
      /** Expected Version */
      expected_version: number
      /**
       * Reason
       * @default
       */
      reason: string
    }
    /** MaterialTransferResponse */
    MaterialTransferResponse: {
      /** Allowed Actions */
      allowed_actions: string[]
      /** Barcode Payload */
      barcode_payload: string
      /** Barcode Type */
      barcode_type: string
      /** Batch No */
      batch_no: string
      /**
       * Can Edit Delivery
       * @default false
       */
      can_edit_delivery: boolean
      /** Category Level3 */
      category_level3?: string | null
      /**
       * Created At
       * Format: date-time
       */
      created_at: string
      /** Created By */
      created_by: string
      /** Created By User Id */
      created_by_user_id: number | null
      /** Customer Code */
      customer_code?: string | null
      /** Delivery Date */
      delivery_date?: string | null
      /** Delivery Origin Batch No */
      delivery_origin_batch_no?: string | null
      /** Delivery Quantity */
      delivery_quantity?: number | null
      /** Dispatch No */
      dispatch_no?: string | null
      /** Dispatched At */
      dispatched_at?: string | null
      /** Dispatched By */
      dispatched_by?: string | null
      /** Dispatched By User Id */
      dispatched_by_user_id?: number | null
      /**
       * Entry Kind
       * @default transfer
       */
      entry_kind: string
      /** External Destination */
      external_destination?: string | null
      /** External Source */
      external_source?: string | null
      /** Finished Quantity */
      finished_quantity?: number | null
      /** Finished Specification */
      finished_specification?: string | null
      /** History */
      history?: components['schemas']['MaterialTransferEventResponse'][]
      /** Id */
      id: number
      /** Locked */
      locked: boolean
      /** Locked At */
      locked_at: string | null
      /** Loss Records */
      loss_records?: {
        [key: string]: unknown
      }[]
      /** Material Description */
      material_description?: string | null
      /** Material Name */
      material_name?: string | null
      /** Material Shape */
      material_shape?: string | null
      /** Material Type */
      material_type?: string | null
      next_team: components['schemas']['MaterialTransferTeamSnapshot'] | null
      /** Next Team Id */
      next_team_id: number | null
      /** Notes */
      notes: string | null
      /** Order Category */
      order_category?: string | null
      /** Outsourced Unit */
      outsourced_unit?: string | null
      /** Part No */
      part_no?: string | null
      /** Process Route */
      process_route?: {
        [key: string]: unknown
      } | null
      /** Processing Role */
      processing_role?: ('remaining' | 'produced' | 'scrap') | null
      /** Product Code */
      product_code?: string | null
      /** Purpose Category */
      purpose_category?: string | null
      /** Purpose Id */
      purpose_id?: number | null
      /** Purpose Name */
      purpose_name?: string | null
      /** Quantity */
      quantity: number
      /** Quantity Unit */
      quantity_unit: string
      /** Receipt Kind */
      receipt_kind?: string | null
      /** Received At */
      received_at: string | null
      /** Received By */
      received_by: string | null
      /** Received By User Id */
      received_by_user_id: number | null
      /** Received Employee Id */
      received_employee_id?: number | null
      /** Received Employee Name */
      received_employee_name?: string | null
      /** Rejection Reason */
      rejection_reason?: string | null
      /** Return Dispatch No */
      return_dispatch_no?: string | null
      /**
       * Rework Count
       * @default 0
       */
      rework_count: number
      /**
       * Rework Pending
       * @default false
       */
      rework_pending: boolean
      /** Rework Route Id */
      rework_route_id?: number | null
      /**
       * Rework Route Ready
       * @default false
       */
      rework_route_ready: boolean
      /** Sent Employee Id */
      sent_employee_id?: number | null
      /** Sent Employee Name */
      sent_employee_name?: string | null
      /** Sent Processing Status */
      sent_processing_status?: string | null
      /** Serial No */
      serial_no: string
      /** Shared Group Id */
      shared_group_id?: number | null
      /** Shared Origin Batch No */
      shared_origin_batch_no?: string | null
      /** Shared Serials */
      shared_serials?: components['schemas']['SharedMaterialSerial-Output'][]
      /**
       * Shared Unallocated
       * @default false
       */
      shared_unallocated: boolean
      /** Sludge Content Percent */
      sludge_content_percent?: number | null
      /** Sludge Gross Weight */
      sludge_gross_weight?: number | null
      /**
       * Sludge Percent Locked
       * @default false
       */
      sludge_percent_locked: boolean
      /** Source Batch No */
      source_batch_no?: string | null
      /** Source Serial No */
      source_serial_no?: string | null
      source_team: components['schemas']['MaterialTransferTeamSnapshot'] | null
      /** Source Team Id */
      source_team_id: number | null
      /** Source Transfer Batch No */
      source_transfer_batch_no?: string | null
      /** Source Transfer Id */
      source_transfer_id?: number | null
      /** Special Process */
      special_process?: string | null
      /** Status */
      status: string
      /**
       * Stock Tracked
       * @default false
       */
      stock_tracked: boolean
      /** Technical Requirements */
      technical_requirements?: string | null
      /** Transfer Specification */
      transfer_specification?: string | null
      /**
       * Updated At
       * Format: date-time
       */
      updated_at: string
      /** Urgency */
      urgency?: {
        [key: string]: unknown
      } | null
      /** Version */
      version: number
      /** Voided At */
      voided_at: string | null
      /** Voided By */
      voided_by: string | null
      /** Voided By User Id */
      voided_by_user_id: number | null
      /** Warehouse Location */
      warehouse_location?: string | null
      /** Weight */
      weight: number
      /** Weight Unit */
      weight_unit: string
    }
    /** MaterialTransferSummary */
    MaterialTransferSummary: {
      pending: components['schemas']['MaterialTransferAmounts']
      received: components['schemas']['MaterialTransferAmounts']
    }
    /** MaterialTransferTeamSnapshot */
    MaterialTransferTeamSnapshot: {
      /** Code */
      code: string
      /** Id */
      id: number
      /** Kind */
      kind?: string | null
      /** Name */
      name: string
    }
    /** MaterialTransferUpdate */
    MaterialTransferUpdate: {
      /** Category Level3 */
      category_level3?: string | null
      /** Customer Code */
      customer_code?: string | null
      /** Delivery Date */
      delivery_date?: string | null
      /** Delivery Quantity */
      delivery_quantity?: number | null
      /** Expected Version */
      expected_version?: number | null
      /** Finished Quantity */
      finished_quantity?: number | null
      /** Finished Specification */
      finished_specification?: string | null
      /** Material Description */
      material_description?: string | null
      /** Material Name */
      material_name?: string | null
      /** Material Shape */
      material_shape?: string | null
      /** Material Type */
      material_type?: string | null
      /** Next Team Id */
      next_team_id?: number | null
      /** Notes */
      notes?: string | null
      /** Order Category */
      order_category?: string | null
      /** Outsourced Unit */
      outsourced_unit?: string | null
      /** Part No */
      part_no?: string | null
      /** Product Code */
      product_code?: string | null
      /** Purpose Category */
      purpose_category?: string | null
      /** Purpose Id */
      purpose_id?: number | null
      /** Quantity */
      quantity?: number | null
      quantity_clearance?: components['schemas']['OutboundQuantityClearance'] | null
      /** Serial No */
      serial_no?: string | null
      /** Sludge Content Percent */
      sludge_content_percent?: number | string | null
      /** Sludge Gross Weight */
      sludge_gross_weight?: number | string | null
      /** Source Batch No */
      source_batch_no?: string | null
      /** Special Process */
      special_process?: string | null
      /** Technical Requirements */
      technical_requirements?: string | null
      /** Transfer Specification */
      transfer_specification?: string | null
      /** Warehouse Location */
      warehouse_location?: string | null
      /** Warehouse Location Reservation Key */
      warehouse_location_reservation_key?: string | null
      /** Weight */
      weight?: number | string | null
    }
    /** MaterialTypeBalanceResponse */
    MaterialTypeBalanceResponse: {
      /** Adjusted Quantity */
      adjusted_quantity: number
      /** Adjusted Weight */
      adjusted_weight: number
      /** Available Quantity */
      available_quantity: number
      /** Available Weight */
      available_weight: number
      /** Dispatched Quantity */
      dispatched_quantity: number
      /** Dispatched Weight */
      dispatched_weight: number
      /** External Pending Quantity */
      external_pending_quantity: number
      /** External Pending Weight */
      external_pending_weight: number
      /** In Transit Quantity */
      in_transit_quantity: number
      /** In Transit Weight */
      in_transit_weight: number
      /** Lost Quantity */
      lost_quantity: number
      /** Lost Weight */
      lost_weight: number
      /** Material Type */
      material_type: string | null
      /** On Hand Quantity */
      on_hand_quantity: number
      /** On Hand Weight */
      on_hand_weight: number
      /** Owned Quantity */
      owned_quantity: number
      /** Owned Weight */
      owned_weight: number
      /** Received Quantity */
      received_quantity: number
      /** Received Weight */
      received_weight: number
      /** Reserved Quantity */
      reserved_quantity: number
      /** Reserved Weight */
      reserved_weight: number
      /** Scrap Available Quantity */
      scrap_available_quantity: number
      /** Scrap Available Weight */
      scrap_available_weight: number
      /** Scrap Quantity */
      scrap_quantity: number
      /** Scrap Weight */
      scrap_weight: number
      /** Shortage Quantity */
      shortage_quantity: number
      /** Shortage Weight */
      shortage_weight: number
    }
    /** MaterialYieldResponse */
    MaterialYieldResponse: {
      /** Active Count */
      active_count: number
      /** Completed Count */
      completed_count: number
      /** Input Weight */
      input_weight: number
      /** Material */
      material: string
      /** Output Weight */
      output_weight: number
      /** Rate */
      rate: number | null
    }
    /** NamedAmountResponse */
    NamedAmountResponse: {
      /** Name */
      name: string
      /** Quantity */
      quantity: number
      /** Weight */
      weight: number
    }
    /** NoticeCursorsResponse */
    NoticeCursorsResponse: {
      /** Quality */
      quality: number
      /** Rework */
      rework: number
      /** Schedule */
      schedule: number
      /** Transfer */
      transfer: number
    }
    /** NoticeReadResponse */
    NoticeReadResponse: {
      /** Read At */
      read_at: string
    }
    /** NoticeTargetResponse */
    NoticeTargetResponse: {
      /** Amendment Id */
      amendment_id?: number | null
      /** Batch Id */
      batch_id?: number | null
      /** Event Id */
      event_id?: number | null
      /** Href */
      href: string
      route?: components['schemas']['ProcessRouteDetailResponse'] | null
      /** Schedule Id */
      schedule_id?: number | null
      /** Section */
      section: ('problem' | 'steps' | 'plan-review' | 'amendment' | 'quality') | null
      /** Step Index */
      step_index?: number | null
    }
    /** NotificationStatusResponse */
    NotificationStatusResponse: {
      /**
       * Connection
       * @enum {string}
       */
      connection: 'connected' | 'reconnecting'
      /** Oldest Pending Seconds */
      oldest_pending_seconds: number
      /** Pending */
      pending: number
    }
    /** OpeningAuthorization */
    OpeningAuthorization: {
      /** Enabled */
      enabled: boolean
    }
    /** OpeningAuthorizationResponse */
    OpeningAuthorizationResponse: {
      /** Enabled */
      enabled: boolean
    }
    /** OpeningCreate */
    OpeningCreate: {
      /** Idempotency Key */
      idempotency_key: string
      /** Lines */
      lines: components['schemas']['OpeningLine'][]
    }
    /** OpeningLine */
    OpeningLine: {
      /** Category Level3 */
      category_level3?: string | null
      /** Customer Code */
      customer_code?: string | null
      /** Delivery Date */
      delivery_date?: string | null
      /** Delivery Quantity */
      delivery_quantity?: number | null
      /** Finished Quantity */
      finished_quantity?: number | null
      /** Finished Specification */
      finished_specification?: string | null
      /** Material Description */
      material_description?: string | null
      /** Material Name */
      material_name: string
      /** Material Shape */
      material_shape?: string | null
      /** Material Type */
      material_type?: string | null
      /** Notes */
      notes?: string | null
      /** Order Category */
      order_category?: string | null
      /** Outsourced Unit */
      outsourced_unit?: string | null
      /** Part No */
      part_no?: string | null
      /** Product Code */
      product_code?: string | null
      /** Purpose Category */
      purpose_category?: string | null
      /** Purpose Id */
      purpose_id?: number | null
      /** Quantity */
      quantity: number
      /** Serial No */
      serial_no: string
      /** Sludge Content Percent */
      sludge_content_percent?: number | string | null
      /** Sludge Gross Weight */
      sludge_gross_weight?: number | string | null
      /** Source Batch No */
      source_batch_no?: string | null
      /** Special Process */
      special_process?: string | null
      /** Technical Requirements */
      technical_requirements?: string | null
      /** Transfer Specification */
      transfer_specification?: string | null
      /** Weight */
      weight: number | string
    }
    /** OpeningStockResultResponse */
    OpeningStockResultResponse: {
      /** Count */
      count: number
      /** Id */
      id: number
      /** Items */
      items: components['schemas']['MaterialTransferResponse'][]
    }
    /** OpeningStockStateResponse */
    OpeningStockStateResponse: {
      /** Can Submit */
      can_submit: boolean
      /** Completed */
      completed: boolean
      /** Enabled */
      enabled: boolean
      /** Has Stock History */
      has_stock_history: boolean
      /** Items */
      items: components['schemas']['MaterialTransferResponse'][]
    }
    /** OutboundQuantityClearance */
    OutboundQuantityClearance: {
      /** Quantity */
      quantity: number
      /**
       * Reason
       * @default
       */
      reason: string
      /** Source Transfer Id */
      source_transfer_id: number
    }
    /** PageResponse[BusinessPersonResponse] */
    PageResponse_BusinessPersonResponse_: {
      /** Items */
      items: components['schemas']['BusinessPersonResponse'][]
      /** Page */
      page: number
      /** Page Size */
      page_size: number
      /** Total */
      total: number
    }
    /** PageResponse[DashboardSerialResponse] */
    PageResponse_DashboardSerialResponse_: {
      /** Items */
      items: components['schemas']['DashboardSerialResponse'][]
      /** Page */
      page: number
      /** Page Size */
      page_size: number
      /** Total */
      total: number
    }
    /** PageResponse[DashboardStockDetailResponse] */
    PageResponse_DashboardStockDetailResponse_: {
      /** Items */
      items: components['schemas']['DashboardStockDetailResponse'][]
      /** Page */
      page: number
      /** Page Size */
      page_size: number
      /** Total */
      total: number
    }
    /** PageResponse[DeliveryResponse] */
    PageResponse_DeliveryResponse_: {
      /** Items */
      items: components['schemas']['DeliveryResponse'][]
      /** Page */
      page: number
      /** Page Size */
      page_size: number
      /** Total */
      total: number
    }
    /** PageResponse[InspectionRecordResponse] */
    PageResponse_InspectionRecordResponse_: {
      /** Items */
      items: components['schemas']['InspectionRecordResponse'][]
      /** Page */
      page: number
      /** Page Size */
      page_size: number
      /** Total */
      total: number
    }
    /** PageResponse[InspectionSourceResponse] */
    PageResponse_InspectionSourceResponse_: {
      /** Items */
      items: components['schemas']['InspectionSourceResponse'][]
      /** Page */
      page: number
      /** Page Size */
      page_size: number
      /** Total */
      total: number
    }
    /** PageResponse[MaterialLossResponse] */
    PageResponse_MaterialLossResponse_: {
      /** Items */
      items: components['schemas']['MaterialLossResponse'][]
      /** Page */
      page: number
      /** Page Size */
      page_size: number
      /** Total */
      total: number
    }
    /** PageResponse[ProcessingDailyResponse] */
    PageResponse_ProcessingDailyResponse_: {
      /** Items */
      items: components['schemas']['ProcessingDailyResponse'][]
      /** Page */
      page: number
      /** Page Size */
      page_size: number
      /** Total */
      total: number
    }
    /** PageResponse[QualityReworkStockResponse] */
    PageResponse_QualityReworkStockResponse_: {
      /** Items */
      items: components['schemas']['QualityReworkStockResponse'][]
      /** Page */
      page: number
      /** Page Size */
      page_size: number
      /** Total */
      total: number
    }
    /** PageResponse[ReworkSourceResponse] */
    PageResponse_ReworkSourceResponse_: {
      /** Items */
      items: components['schemas']['ReworkSourceResponse'][]
      /** Page */
      page: number
      /** Page Size */
      page_size: number
      /** Total */
      total: number
    }
    /** PageResponse[ScheduleResponse] */
    PageResponse_ScheduleResponse_: {
      /** Items */
      items: components['schemas']['ScheduleResponse'][]
      /** Page */
      page: number
      /** Page Size */
      page_size: number
      /** Total */
      total: number
    }
    /** PageResponse[ScheduleSerialOptionResponse] */
    PageResponse_ScheduleSerialOptionResponse_: {
      /** Items */
      items: components['schemas']['ScheduleSerialOptionResponse'][]
      /** Page */
      page: number
      /** Page Size */
      page_size: number
      /** Total */
      total: number
    }
    /** PageResponse[ScheduleSourceOptionResponse] */
    PageResponse_ScheduleSourceOptionResponse_: {
      /** Items */
      items: components['schemas']['ScheduleSourceOptionResponse'][]
      /** Page */
      page: number
      /** Page Size */
      page_size: number
      /** Total */
      total: number
    }
    /** PageResponse[ScheduleTaskResponse] */
    PageResponse_ScheduleTaskResponse_: {
      /** Items */
      items: components['schemas']['ScheduleTaskResponse'][]
      /** Page */
      page: number
      /** Page Size */
      page_size: number
      /** Total */
      total: number
    }
    /** PageResponse[SerialInventoryBatchResponse] */
    PageResponse_SerialInventoryBatchResponse_: {
      /** Items */
      items: components['schemas']['SerialInventoryBatchResponse'][]
      /** Page */
      page: number
      /** Page Size */
      page_size: number
      /** Total */
      total: number
    }
    /** PageResponse[SerialSummaryResponse] */
    PageResponse_SerialSummaryResponse_: {
      /** Items */
      items: components['schemas']['SerialSummaryResponse'][]
      /** Page */
      page: number
      /** Page Size */
      page_size: number
      /** Total */
      total: number
    }
    /** PageResponse[SerialYieldResponse] */
    PageResponse_SerialYieldResponse_: {
      /** Items */
      items: components['schemas']['SerialYieldResponse'][]
      /** Page */
      page: number
      /** Page Size */
      page_size: number
      /** Total */
      total: number
    }
    /** PageResponse[StockBatchResponse] */
    PageResponse_StockBatchResponse_: {
      /** Items */
      items: components['schemas']['StockBatchResponse'][]
      /** Page */
      page: number
      /** Page Size */
      page_size: number
      /** Total */
      total: number
    }
    /** PageResponse[Union[MaterialDispatchResponse, MaterialDispatchSummaryResponse]] */
    PageResponse_Union_MaterialDispatchResponse__MaterialDispatchSummaryResponse__: {
      /** Items */
      items: (
        | components['schemas']['MaterialDispatchResponse']
        | components['schemas']['MaterialDispatchSummaryResponse']
      )[]
      /** Page */
      page: number
      /** Page Size */
      page_size: number
      /** Total */
      total: number
    }
    /** ParsedReceiptProcessResponse */
    ParsedReceiptProcessResponse: {
      /** Field Warnings */
      field_warnings?: string[] | null
      /** Issues */
      issues: string[]
      material_confirmation?: components['schemas']['MaterialConfirmationResponse'] | null
      order_document?: components['schemas']['RouteOrderDocumentResponse'] | null
      /** Original Steps */
      original_steps?: components['schemas']['RouteStepResponse'][] | null
      /** Receipt Fields */
      receipt_fields?: {
        [key: string]: components['schemas']['RouteMaterialFieldResponse']
      } | null
      /** Review Required */
      review_required?: boolean | null
      /** Serial Nos */
      serial_nos: string[]
      /** Steps */
      steps: components['schemas']['RouteStepResponse'][]
      /** Tables */
      tables: string[][][]
      /** Word Fields */
      word_fields?: {
        [key: string]: components['schemas']['RouteMaterialFieldResponse']
      } | null
    }
    /** PasswordChangeRequest */
    PasswordChangeRequest: {
      /** New Password */
      new_password: string
      /** Old Password */
      old_password: string
    }
    /** PendingAmountResponse */
    PendingAmountResponse: {
      /** Batches */
      batches: number
      /** Quantity */
      quantity: number
      /** Weight */
      weight: number
    }
    /** PendingAttentionResponse */
    PendingAttentionResponse: {
      /** Batch No */
      batch_no: string
      /** Created At */
      created_at: string
      /** External Destination */
      external_destination: string | null
      /** Id */
      id: number
      /** Next Team Name */
      next_team_name: string | null
      /** Quantity */
      quantity: number
      /** Serial No */
      serial_no: string | null
      /** Source Team Name */
      source_team_name: string | null
      /** Weight */
      weight: number
    }
    /** PerformanceTeamResponse */
    PerformanceTeamResponse: {
      /** Active */
      active: boolean
      /** Code */
      code: string
      /** Id */
      id: number
      /** Name */
      name: string
    }
    /** PlacementWrite */
    PlacementWrite: {
      /** Expected Version */
      expected_version: number
      /** Quantity */
      quantity: number
      /** Source Transfer Id */
      source_transfer_id: number
      /** Weight */
      weight: number | string
    }
    /** PlanReview */
    PlanReview: {
      /** Approve */
      approve: boolean
      /** Expected Version */
      expected_version: number
      /**
       * Reason
       * @default
       */
      reason: string
    }
    /** ProblemFrequencyResponse */
    ProblemFrequencyResponse: {
      /** Issue Count */
      issue_count: number
      /** Name */
      name: string
      /** Problem Type Id */
      problem_type_id: number | null
      /** Unresolved Count */
      unresolved_count: number
    }
    /** ProcessingDailyResponse */
    ProcessingDailyResponse: {
      /** Completed Quantity */
      completed_quantity: number
      /** Completed Weight */
      completed_weight: number
      /** Duration Record Count */
      duration_record_count: number
      /** Input Quantity */
      input_quantity: number
      /** Input Weight */
      input_weight: number
      /** Process Route Id */
      process_route_id: number | null
      /** Process Step Index */
      process_step_index: number | null
      /** Process Step Name */
      process_step_name: string | null
      /** Processing Date */
      processing_date: string
      /** Processing Minutes */
      processing_minutes: number | null
      /**
       * Processing Mode
       * @enum {string}
       */
      processing_mode: 'unit' | 'split'
      /** Processing Task Id */
      processing_task_id: number | null
      /** Processing Task Name */
      processing_task_name: string | null
      /** Processor Employee Id */
      processor_employee_id: number
      /** Processor Name */
      processor_name: string
      /** Processors */
      processors: components['schemas']['ProcessingPersonResponse'][]
      /** Purpose Id */
      purpose_id: number | null
      /** Purpose Name */
      purpose_name: string | null
      /** Record Count */
      record_count: number
      /** Rework Quantity */
      rework_quantity: number
      /** Rework Record Count */
      rework_record_count: number
      /** Rework Weight */
      rework_weight: number
      /** Scrap Quantity */
      scrap_quantity: number
      /** Scrap Weight */
      scrap_weight: number
      /** Team Id */
      team_id: number
      /** Team Name */
      team_name: string
      /** Work Quantity */
      work_quantity: number
      /** Work Weight */
      work_weight: number
    }
    /** ProcessingFilterOptionResponse */
    ProcessingFilterOptionResponse: {
      /** Id */
      id: number
      /** Name */
      name: string | null
    }
    /** ProcessingInspectionResponse */
    ProcessingInspectionResponse: {
      /** Batch Quantity */
      batch_quantity: number
      /**
       * Checked At
       * Format: date-time
       */
      checked_at: string
      /**
       * Disposition
       * @enum {string}
       */
      disposition: 'pending' | 'rework' | 'shipment' | 'transfer' | 'reallocate' | 'scrap' | 'other'
      /** Failed Quantity */
      failed_quantity: number
      /** Id */
      id: number
      /** Inspector Name */
      inspector_name: string
      /**
       * Kind
       * @enum {string}
       */
      kind: 'patrol' | 'inspection'
      /** Notes */
      notes: string
      /** Parent Id */
      parent_id: number | null
      /** Passed Quantity */
      passed_quantity: number
      /** Problem Names */
      problem_names: string[]
      /** Sample Quantity */
      sample_quantity: number
      /**
       * Scope
       * @enum {string}
       */
      scope: 'sample' | 'full'
      /** Source Transfer Id */
      source_transfer_id: number
    }
    /** ProcessingOutput */
    ProcessingOutput: {
      /** Material Type */
      material_type: string
      /** Quantity */
      quantity: number
      /**
       * Role
       * @enum {string}
       */
      role: 'remaining' | 'produced' | 'scrap'
      /** Serial No */
      serial_no?: string | null
      /** Sludge Content Percent */
      sludge_content_percent?: number | string | null
      /** Sludge Gross Weight */
      sludge_gross_weight?: number | string | null
      /** Transfer Specification */
      transfer_specification?: string | null
      /** Weight */
      weight: number | string
    }
    /** ProcessingOutputResponse */
    ProcessingOutputResponse: {
      /** Batch No */
      batch_no: string
      /** Id */
      id: number
      /** In Transit Quantity */
      in_transit_quantity?: number | null
      /** In Transit Weight */
      in_transit_weight?: number | null
      /** Material Type */
      material_type: string
      /** On Hand Quantity */
      on_hand_quantity?: number | null
      /** On Hand Weight */
      on_hand_weight?: number | null
      /** Owned Quantity */
      owned_quantity?: number | null
      /** Owned Weight */
      owned_weight?: number | null
      /** Quantity */
      quantity: number
      /**
       * Role
       * @enum {string}
       */
      role: 'remaining' | 'produced' | 'scrap'
      /** Serial No */
      serial_no?: string | null
      /**
       * Shared Unallocated
       * @default false
       */
      shared_unallocated: boolean
      /** Sludge Content Percent */
      sludge_content_percent?: number | null
      /** Sludge Gross Weight */
      sludge_gross_weight?: number | null
      /** Transfer Specification */
      transfer_specification: string | null
      /** Weight */
      weight: number
    }
    /** ProcessingPersonResponse */
    ProcessingPersonResponse: {
      /** Id */
      id: number
      /** Name */
      name: string | null
    }
    /** ProcessingQuantity */
    ProcessingQuantity: {
      /** Actual Temperature C */
      actual_temperature_c?: number | string | null
      /** Completed Quantity */
      completed_quantity?: number | null
      /** Completed Weight */
      completed_weight?: number | string | null
      /** Expected Revision */
      expected_revision: number
      /** Furnace No */
      furnace_no?: string | null
      /** Holding Minutes */
      holding_minutes?: number | null
      /** Input Quantity */
      input_quantity?: number | null
      /** Machine No */
      machine_no?: string | null
      /** Outputs */
      outputs?: components['schemas']['ProcessingOutput'][] | null
      /** Processing Date */
      processing_date?: string | null
      /** Processing Minutes */
      processing_minutes?: number | null
      /** Processing Mode */
      processing_mode?: ('unit' | 'split') | null
      /** Processing Status */
      processing_status?: ('partial' | 'complete') | null
      /** Processing Task Id */
      processing_task_id?: number | null
      /** Processor Employee Id */
      processor_employee_id?: number | null
      /** Processor Employee Ids */
      processor_employee_ids?: number[] | null
      /** Processor Name */
      processor_name: string
      /** Production Schedule Id */
      production_schedule_id?: number | null
      /** Purpose Id */
      purpose_id?: number | null
      /** Quantity */
      quantity: number
      /**
       * Reason
       * @default
       */
      reason: string
      /** Rework Of Id */
      rework_of_id?: number | null
      /** Source Transfer Id */
      source_transfer_id: number
      /** Temperature Requirement */
      temperature_requirement?: string | null
      /** Transfer Specification */
      transfer_specification?: string | null
      /**
       * Work Kind
       * @default initial
       * @enum {string}
       */
      work_kind: 'initial' | 'rework'
    }
    /** ProcessingRecordPageResponse */
    ProcessingRecordPageResponse: {
      /**
       * As Of
       * Format: date-time
       */
      as_of: string
      /** Items */
      items: components['schemas']['ProcessingRecordResponse'][]
      /** Page */
      page: number
      /** Page Size */
      page_size: number
      /** Parameter Fields */
      parameter_fields: string[]
      /** Processing Tasks */
      processing_tasks: components['schemas']['ProcessingFilterOptionResponse'][]
      /** Processors */
      processors: components['schemas']['ProcessingFilterOptionResponse'][]
      summary: components['schemas']['ProcessingSummaryResponse']
      /** Total */
      total: number
    }
    /** ProcessingRecordResponse */
    ProcessingRecordResponse: {
      /** Actual Temperature C */
      actual_temperature_c: number | null
      /** After Quantity */
      after_quantity: number
      /** After Specification */
      after_specification: string | null
      /** After Weight */
      after_weight: number | null
      /** Batch No */
      batch_no: string
      /** Before Quantity */
      before_quantity: number
      /** Before Specification */
      before_specification: string | null
      /** Completed Quantity */
      completed_quantity: number | null
      /** Completed Weight */
      completed_weight: number | null
      /**
       * Created At
       * Format: date-time
       */
      created_at: string
      /** Created By */
      created_by: string
      /** Delta Quantity */
      delta_quantity: number
      /** Finished Quantity */
      finished_quantity: number | null
      /** Furnace No */
      furnace_no: string | null
      /** Holding Minutes */
      holding_minutes: number | null
      /** Id */
      id: number
      /** In Transit Quantity */
      in_transit_quantity: number
      /** In Transit Weight */
      in_transit_weight: number
      /** Input Quantity */
      input_quantity: number | null
      /** Input Weight */
      input_weight: number | null
      /** Machine No */
      machine_no: string | null
      /** Material Name */
      material_name: string | null
      /** Material Type */
      material_type: string | null
      /** On Hand Quantity */
      on_hand_quantity: number
      /** On Hand Weight */
      on_hand_weight: number
      /**
       * Operation Kind
       * @enum {string}
       */
      operation_kind: 'outbound_clearance' | 'processing'
      /** Outputs */
      outputs: components['schemas']['ProcessingOutputResponse'][] | null
      /** Owned Quantity */
      owned_quantity: number
      /** Owned Weight */
      owned_weight: number
      /** Process Route Id */
      process_route_id: number | null
      /** Process Step Index */
      process_step_index: number | null
      /** Process Step Instructions */
      process_step_instructions: string | null
      /** Process Step Name */
      process_step_name: string | null
      /** Processing Date */
      processing_date: string | null
      /** Processing Minutes */
      processing_minutes: number | null
      /** Processing Mode */
      processing_mode: ('unit' | 'split') | null
      /**
       * Processing State
       * @enum {string}
       */
      processing_state:
        | 'registered'
        | 'partial'
        | 'complete'
        | 'unregistered'
        | 'rework'
        | 'pending'
        | 'cleared'
        | 'not_applicable'
      /** Processing Status */
      processing_status: ('partial' | 'complete') | null
      /** Processing Task Id */
      processing_task_id: number | null
      /** Processing Task Name */
      processing_task_name: string | null
      /** Processor Employee Id */
      processor_employee_id: number | null
      /** Processor Name */
      processor_name: string | null
      /** Processors */
      processors: components['schemas']['ProcessingPersonResponse'][]
      /** Production Schedule Id */
      production_schedule_id: number | null
      /** Purpose Id */
      purpose_id: number | null
      /** Purpose Name */
      purpose_name: string | null
      /** Reason */
      reason: string
      /** Report Inspections */
      report_inspections: components['schemas']['ProcessingInspectionResponse'][]
      /** Rework Of Id */
      rework_of_id: number | null
      /** Rework Round */
      rework_round: number
      /** Scrap Quantity */
      scrap_quantity: number | null
      /** Scrap Weight */
      scrap_weight: number | null
      /** Serial No */
      serial_no: string
      /** Shared Group Id */
      shared_group_id: number | null
      /** Shared Origin Batch No */
      shared_origin_batch_no?: string | null
      /** Shared Serials */
      shared_serials?: components['schemas']['SharedSerialResponse'][] | null
      /** Shared Unallocated */
      shared_unallocated: boolean
      /** Source Transfer Id */
      source_transfer_id: number
      /** Temperature Requirement */
      temperature_requirement: string | null
      /** Weight */
      weight: number
      /**
       * Work Kind
       * @enum {string}
       */
      work_kind: 'initial' | 'rework'
    }
    /** ProcessingSummaryResponse */
    ProcessingSummaryResponse: {
      /** Completed Quantity */
      completed_quantity: number
      /** Completed Weight */
      completed_weight: number
      /** Daily Group Count */
      daily_group_count: number
      /** Duration Record Count */
      duration_record_count: number
      /** Employee Day Count */
      employee_day_count: number
      /** Input Quantity */
      input_quantity: number
      /** Input Weight */
      input_weight: number
      /** Processing Minutes */
      processing_minutes: number | null
      /** Record Count */
      record_count: number
      /** Rework Quantity */
      rework_quantity: number
      /** Rework Record Count */
      rework_record_count: number
      /** Rework Weight */
      rework_weight: number
      /** Scrap Quantity */
      scrap_quantity: number
      /** Scrap Weight */
      scrap_weight: number
      /** Unreported Count */
      unreported_count: number
      /** Work Quantity */
      work_quantity: number
      /** Work Weight */
      work_weight: number
    }
    /** ProcessRouteDetailResponse */
    ProcessRouteDetailResponse: {
      /** Created At */
      created_at: string
      /** Created By */
      created_by: string
      /** Created By User Id */
      created_by_user_id: number | null
      /** Drawings */
      drawings: components['schemas']['RouteDrawingResponse'][]
      /** Engineering Employee Id */
      engineering_employee_id: number | null
      /** Engineering Employee Name */
      engineering_employee_name: string | null
      execution_labels: components['schemas']['RouteExecutionLabelsResponse']
      /** Filename */
      filename: string
      /** Id */
      id: number
      /** Missing Documents */
      missing_documents: string[]
      /** Modified Employee Id */
      modified_employee_id: number | null
      /** Modified Employee Name */
      modified_employee_name: string | null
      /** Parent Id */
      parent_id: number | null
      /** Published At */
      published_at: string | null
      /** Review Note */
      review_note: string | null
      rework_request: components['schemas']['ReworkRequestResponse'] | null
      /**
       * Route Kind
       * @enum {string}
       */
      route_kind: 'normal' | 'rework'
      /** Serial Nos */
      serial_nos: string[]
      source_data: components['schemas']['RouteSourceDataResponse']
      /** Source Sha256 */
      source_sha256: string
      /**
       * State
       * @enum {string}
       */
      state: 'draft' | 'published'
      /** Steps */
      steps: components['schemas']['RouteStepResponse'][]
      /** Title */
      title: string
      /** Updated At */
      updated_at: string | null
      /** Version */
      version: number
    }
    /** ProcessRoutePageResponse */
    ProcessRoutePageResponse: {
      /** Enforced After */
      enforced_after: string | null
      /** Items */
      items: components['schemas']['ProcessRouteSummaryResponse'][]
      /** Page */
      page: number
      /** Page Size */
      page_size: number
      /** Pending Rework Count */
      pending_rework_count: number
      /** Total */
      total: number
    }
    /** ProcessRouteParseResponse */
    ProcessRouteParseResponse: {
      /** Filename */
      filename: string
      /** Serial Nos */
      serial_nos: string[]
      source_data: components['schemas']['RouteSourceDataResponse']
      /** Steps */
      steps: components['schemas']['RouteStepResponse'][]
      /** Title */
      title: string
    }
    /** ProcessRouteSummaryResponse */
    ProcessRouteSummaryResponse: {
      /** Created At */
      created_at: string
      /** Created By */
      created_by: string
      /** Created By User Id */
      created_by_user_id: number | null
      /** Drawings */
      drawings: components['schemas']['RouteDrawingResponse'][]
      /** Engineering Employee Id */
      engineering_employee_id: number | null
      /** Engineering Employee Name */
      engineering_employee_name: string | null
      /** Filename */
      filename: string
      /** Id */
      id: number
      /** Material Name */
      material_name: string
      /** Missing Documents */
      missing_documents: string[]
      /** Modified Employee Id */
      modified_employee_id: number | null
      /** Modified Employee Name */
      modified_employee_name: string | null
      /** Parent Id */
      parent_id: number | null
      /** Published At */
      published_at: string | null
      /** Rework Batch No */
      rework_batch_no?: string | null
      rework_progress?: components['schemas']['ReworkProgressResponse'] | null
      /** Rework Quantity */
      rework_quantity?: number | null
      rework_request: components['schemas']['ReworkRequestResponse'] | null
      /** Rework Weight */
      rework_weight?: number | null
      /**
       * Route Kind
       * @enum {string}
       */
      route_kind: 'normal' | 'rework'
      /** Serial Nos */
      serial_nos: string[]
      /**
       * State
       * @enum {string}
       */
      state: 'draft' | 'published'
      /** Step Summary */
      step_summary: components['schemas']['RouteStepSummaryResponse'][]
      /** Title */
      title: string
      /** Updated At */
      updated_at: string | null
      /** Version */
      version: number
    }
    /** ProductionActivityResponse */
    ProductionActivityResponse: {
      /** Teams */
      teams: components['schemas']['TeamProductionResponse'][]
      totals: components['schemas']['ProductionMetricsResponse']
      /** Trend */
      trend: components['schemas']['ProductionTrendResponse'][]
    }
    /** ProductionMetricsResponse */
    ProductionMetricsResponse: {
      /** Completed Quantity */
      completed_quantity: number
      /** Completed Weight */
      completed_weight: number
      /** Initial Record Count */
      initial_record_count: number
      /** Record Count */
      record_count: number
      /** Rework Quantity */
      rework_quantity: number
      /** Rework Record Count */
      rework_record_count: number
      /** Rework Weight */
      rework_weight: number
      /** Work Quantity */
      work_quantity: number
      /** Work Weight */
      work_weight: number
    }
    /** ProductionReportResponse */
    ProductionReportResponse: {
      scope: components['schemas']['ProductionScopeResponse'] | null
      /** Scopes */
      scopes: components['schemas']['ProductionScopeResponse'][]
      totals: components['schemas']['ProductionMetricsResponse']
      /** Trend */
      trend: components['schemas']['ProductionTrendResponse'][]
    }
    /** ProductionScopeResponse */
    ProductionScopeResponse: {
      /** Completed Quantity */
      completed_quantity: number
      /** Completed Weight */
      completed_weight: number
      /** Initial Record Count */
      initial_record_count: number
      /** Material Name */
      material_name: string | null
      /** Process Route Id */
      process_route_id: number | null
      /** Process Step Index */
      process_step_index: number | null
      /** Process Step Name */
      process_step_name: string | null
      /** Processing Task Name */
      processing_task_name: string | null
      /** Purpose Name */
      purpose_name: string | null
      /** Record Count */
      record_count: number
      /** Rework Quantity */
      rework_quantity: number
      /** Rework Record Count */
      rework_record_count: number
      /** Rework Weight */
      rework_weight: number
      /** Scope Id */
      scope_id: number
      /** Serial No */
      serial_no: string
      /** Team Id */
      team_id: number
      /** Team Name */
      team_name: string
      /** Work Quantity */
      work_quantity: number
      /** Work Weight */
      work_weight: number
    }
    /** ProductionTrendResponse */
    ProductionTrendResponse: {
      /** Completed Quantity */
      completed_quantity: number
      /** Completed Weight */
      completed_weight: number
      /** Date */
      date: string
      /** Initial Record Count */
      initial_record_count: number
      /** Record Count */
      record_count: number
      /** Rework Quantity */
      rework_quantity: number
      /** Rework Record Count */
      rework_record_count: number
      /** Rework Weight */
      rework_weight: number
      /** Work Quantity */
      work_quantity: number
      /** Work Weight */
      work_weight: number
    }
    /**
     * ProfileUpdate
     * @description Self-service fields only; account permissions are never writable here.
     */
    ProfileUpdate: {
      /** Avatar Key */
      avatar_key?:
        | (
            | ''
            | 'portrait-1'
            | 'portrait-2'
            | 'portrait-3'
            | 'portrait-4'
            | 'portrait-5'
            | 'portrait-6'
            | 'portrait-7'
            | 'portrait-8'
            | 'portrait-9'
            | 'portrait-10'
            | 'portrait-11'
            | 'portrait-12'
            | 'portrait-13'
            | 'portrait-14'
            | 'portrait-15'
            | 'portrait-16'
          )
        | null
      /** Display Name */
      display_name?: string | null
    }
    /** QualityFeedbackDetailResponse */
    QualityFeedbackDetailResponse: {
      /** Batch No */
      batch_no: string
      /** Batch Quantity */
      batch_quantity: number
      /** Blocks Outbound */
      blocks_outbound: boolean
      /** Checked At */
      checked_at: string
      /** Created By */
      created_by: string
      /** Decision Notes */
      decision_notes: string
      /** Dimension Result */
      dimension_result: string
      /**
       * Disposition
       * @enum {string}
       */
      disposition: 'pending' | 'rework' | 'shipment' | 'transfer' | 'reallocate' | 'scrap' | 'other'
      /** Events */
      events: components['schemas']['FeedbackEventResponse'][]
      /** Failed Quantity */
      failed_quantity: number
      /**
       * Feedback Status
       * @enum {string}
       */
      feedback_status: 'pending' | 'processing' | 'closed'
      /** Feedback Version */
      feedback_version: number
      /** Id */
      id: number
      /** Inspector Employee Id */
      inspector_employee_id: number
      /** Inspector Name */
      inspector_name: string
      /** Involved Teams */
      involved_teams: components['schemas']['FeedbackTeamResponse'][]
      /** Items */
      items: ('appearance' | 'dimension' | 'weight')[]
      /**
       * Kind
       * @enum {string}
       */
      kind: 'patrol' | 'inspection'
      /** Material Name */
      material_name: string | null
      /** Methods */
      methods: ('visual' | 'microscope')[]
      /** Notes */
      notes: string
      /** Parent Id */
      parent_id: number | null
      /** Passed Quantity */
      passed_quantity: number
      /** Problems */
      problems: components['schemas']['InspectionProblemResponse'][]
      process_step: components['schemas']['RouteExecutionContextResponse'] | null
      /** Processing Record Id */
      processing_record_id: number | null
      /** Processor Name */
      processor_name: string | null
      /** Quality Issue Id */
      quality_issue_id: number | null
      /** Rechecks */
      rechecks: components['schemas']['InspectionRecordResponse'][]
      /** Released At */
      released_at: string | null
      /** Sample Quantity */
      sample_quantity: number
      /**
       * Scope
       * @enum {string}
       */
      scope: 'sample' | 'full'
      /** Serial No */
      serial_no: string
      /** Source Transfer Id */
      source_transfer_id: number
      /** Specification */
      specification: string | null
      /**
       * Status
       * @enum {string}
       */
      status: 'pending' | 'released' | 'passed' | 'failed'
      /** Team Id */
      team_id: number
      /** Team Name */
      team_name: string
      /** Weight Result */
      weight_result: string
    }
    /** QualityFeedbackPageResponse */
    QualityFeedbackPageResponse: {
      /** Items */
      items: components['schemas']['QualityFeedbackResponse'][]
      /** Page */
      page: number
      /** Page Size */
      page_size: number
      /** Pending Count */
      pending_count: number
      /** Total */
      total: number
    }
    /** QualityFeedbackResponse */
    QualityFeedbackResponse: {
      /** Batch No */
      batch_no: string
      /** Batch Quantity */
      batch_quantity: number
      /** Blocks Outbound */
      blocks_outbound: boolean
      /** Checked At */
      checked_at: string
      /** Created By */
      created_by: string
      /** Decision Notes */
      decision_notes: string
      /** Dimension Result */
      dimension_result: string
      /**
       * Disposition
       * @enum {string}
       */
      disposition: 'pending' | 'rework' | 'shipment' | 'transfer' | 'reallocate' | 'scrap' | 'other'
      /** Failed Quantity */
      failed_quantity: number
      /**
       * Feedback Status
       * @enum {string}
       */
      feedback_status: 'pending' | 'processing' | 'closed'
      /** Feedback Version */
      feedback_version: number
      /** Id */
      id: number
      /** Inspector Employee Id */
      inspector_employee_id: number
      /** Inspector Name */
      inspector_name: string
      /** Involved Teams */
      involved_teams: components['schemas']['FeedbackTeamResponse'][]
      /** Items */
      items: ('appearance' | 'dimension' | 'weight')[]
      /**
       * Kind
       * @enum {string}
       */
      kind: 'patrol' | 'inspection'
      /** Material Name */
      material_name: string | null
      /** Methods */
      methods: ('visual' | 'microscope')[]
      /** Notes */
      notes: string
      /** Parent Id */
      parent_id: number | null
      /** Passed Quantity */
      passed_quantity: number
      /** Problems */
      problems: components['schemas']['InspectionProblemResponse'][]
      process_step: components['schemas']['RouteExecutionContextResponse'] | null
      /** Processing Record Id */
      processing_record_id: number | null
      /** Processor Name */
      processor_name: string | null
      /** Quality Issue Id */
      quality_issue_id: number | null
      /** Released At */
      released_at: string | null
      /** Sample Quantity */
      sample_quantity: number
      /**
       * Scope
       * @enum {string}
       */
      scope: 'sample' | 'full'
      /** Serial No */
      serial_no: string
      /** Source Transfer Id */
      source_transfer_id: number
      /** Specification */
      specification: string | null
      /**
       * Status
       * @enum {string}
       */
      status: 'pending' | 'released' | 'passed' | 'failed'
      /** Team Id */
      team_id: number
      /** Team Name */
      team_name: string
      /** Weight Result */
      weight_result: string
    }
    /** QualityReportResponse */
    QualityReportResponse: {
      /** Groups */
      groups: components['schemas']['GroupQualityResponse'][]
      /** Materials */
      materials: components['schemas']['MaterialQualityResponse'][]
      /** Trend */
      trend: components['schemas']['QualityTrendResponse'][]
    }
    /** QualityReworkStockResponse */
    QualityReworkStockResponse: {
      /** Batch No */
      batch_no: string
      /** Id */
      id: number
      /** Quantity */
      quantity: number
      /** Serial No */
      serial_no: string
      /** Team Name */
      team_name: string
      /** Weight */
      weight: number
    }
    /** QualityTrendResponse */
    QualityTrendResponse: {
      /** Checked Quantity */
      checked_quantity: number
      /** Date */
      date: string
      /** Failed Quantity */
      failed_quantity: number
      /**
       * Kind
       * @enum {string}
       */
      kind: 'patrol' | 'inspection'
      /** Material Name */
      material_name: string | null
      /** Pass Rate */
      pass_rate: number | null
      /** Passed Quantity */
      passed_quantity: number
      /**
       * Phase
       * @enum {string}
       */
      phase: 'first' | 'recheck'
      /** Record Count */
      record_count: number
      /**
       * Scope
       * @enum {string}
       */
      scope: 'sample' | 'full'
    }
    /** QuantityAdjustmentContextResponse */
    QuantityAdjustmentContextResponse: {
      /** Allowed Task Ids */
      allowed_task_ids: number[]
      /**
       * As Of
       * Format: date-time
       */
      as_of: string
      /** Batch No */
      batch_no: string
      /** Completed Task Ids */
      completed_task_ids: number[]
      /** Items */
      items: components['schemas']['QuantityAdjustmentResponse'][]
      /** Material Name */
      material_name: string | null
      /** Material Type */
      material_type: string | null
      origin_processing_record: components['schemas']['QuantityAdjustmentResponse'] | null
      /** Page */
      page: number
      /** Page Size */
      page_size: number
      /** Parameter Fields */
      parameter_fields: string[]
      process_route: components['schemas']['RouteExecutionContextResponse'] | null
      /**
       * Processing Mode
       * @enum {string}
       */
      processing_mode: 'unit' | 'split'
      /** Processing Schedules */
      processing_schedules: components['schemas']['ScheduleResponse'][]
      /** Processing Status */
      processing_status: ('partial' | 'complete') | null
      /** Processor Options */
      processor_options: string[]
      /** Production Schedule Id */
      production_schedule_id: number | null
      /** Production Schedule Locked */
      production_schedule_locked: boolean
      /** Purpose Id */
      purpose_id: number | null
      /** Purpose Name */
      purpose_name: string | null
      /** Quantity */
      quantity: number
      /** Revision */
      revision: number
      /** Rework Count */
      rework_count: number
      /** Rework Inspections */
      rework_inspections: components['schemas']['ReworkInspectionReference'][]
      /** Rework Of Id */
      rework_of_id: number | null
      /** Rework Pending */
      rework_pending: boolean
      /** Rework Round */
      rework_round: number | null
      /** Rework Route Id */
      rework_route_id: number | null
      /** Rework Route Ready */
      rework_route_ready: boolean
      /** Rework Task Records */
      rework_task_records: components['schemas']['ReworkTaskRecordResponse'][]
      /** Serial No */
      serial_no: string
      /** Shared Group Id */
      shared_group_id: number | null
      /** Shared Origin Batch No */
      shared_origin_batch_no?: string | null
      /** Shared Serials */
      shared_serials?: components['schemas']['SharedSerialResponse'][] | null
      /** Shared Unallocated */
      shared_unallocated: boolean
      /** Source Transfer Id */
      source_transfer_id: number
      /** Task Required */
      task_required: boolean
      /** Total */
      total: number
      /** Transfer Specification */
      transfer_specification: string | null
      /** Weight */
      weight: number
      /** Weight Difference */
      weight_difference?: number | null
      /** Weight Root Transfer Id */
      weight_root_transfer_id?: number | null
    }
    /** QuantityAdjustmentResponse */
    QuantityAdjustmentResponse: {
      /** Actual Temperature C */
      actual_temperature_c: number | null
      /** After Quantity */
      after_quantity: number
      /** After Specification */
      after_specification: string | null
      /** After Weight */
      after_weight: number | null
      /** Before Quantity */
      before_quantity: number
      /** Before Specification */
      before_specification: string | null
      /** Completed Quantity */
      completed_quantity: number | null
      /** Completed Weight */
      completed_weight: number | null
      /**
       * Created At
       * Format: date-time
       */
      created_at: string
      /** Created By */
      created_by: string
      /** Delta Quantity */
      delta_quantity: number
      /** Furnace No */
      furnace_no: string | null
      /** Holding Minutes */
      holding_minutes: number | null
      /** Id */
      id: number
      /** Input Quantity */
      input_quantity: number | null
      /** Input Weight */
      input_weight: number | null
      /** Machine No */
      machine_no: string | null
      /**
       * Operation Kind
       * @enum {string}
       */
      operation_kind: 'outbound_clearance' | 'processing'
      /** Outputs */
      outputs: components['schemas']['ProcessingOutputResponse'][] | null
      /** Process Route Id */
      process_route_id: number | null
      /** Process Step Index */
      process_step_index: number | null
      /** Process Step Instructions */
      process_step_instructions: string | null
      /** Process Step Name */
      process_step_name: string | null
      /** Processing Date */
      processing_date: string | null
      /** Processing Minutes */
      processing_minutes: number | null
      /** Processing Mode */
      processing_mode: ('unit' | 'split') | null
      /** Processing Status */
      processing_status: ('partial' | 'complete') | null
      /** Processing Task Id */
      processing_task_id: number | null
      /** Processing Task Name */
      processing_task_name: string | null
      /** Processor Employee Id */
      processor_employee_id: number | null
      /** Processor Name */
      processor_name: string | null
      /** Processors */
      processors: components['schemas']['ProcessingPersonResponse'][]
      /** Production Schedule Id */
      production_schedule_id: number | null
      /** Purpose Id */
      purpose_id: number | null
      /** Purpose Name */
      purpose_name: string | null
      /** Reason */
      reason: string
      /** Rework Of Id */
      rework_of_id: number | null
      /** Rework Round */
      rework_round: number
      /** Scrap Quantity */
      scrap_quantity: number | null
      /** Scrap Weight */
      scrap_weight: number | null
      /** Source Transfer Id */
      source_transfer_id: number
      /** Temperature Requirement */
      temperature_requirement: string | null
      /** Weight */
      weight: number
      /**
       * Work Kind
       * @enum {string}
       */
      work_kind: 'initial' | 'rework'
    }
    /** ReadResponse */
    ReadResponse: Record<string, never>
    /** ReallocationCreate */
    ReallocationCreate: {
      /** Idempotency Key */
      idempotency_key: string
      /** Quantity */
      quantity: number
      /**
       * Reason
       * @default
       */
      reason: string
      /** Serial No */
      serial_no: string
      /** Sludge Content Percent */
      sludge_content_percent?: number | string | null
      /** Sludge Gross Weight */
      sludge_gross_weight?: number | string | null
      /** Source Transfer Id */
      source_transfer_id: number
      /** Warehouse Location */
      warehouse_location?: string | null
      /** Warehouse Location Reservation Key */
      warehouse_location_reservation_key?: string | null
      /** Weight */
      weight: number | string
    }
    /** ReceiptDocumentResponse */
    ReceiptDocumentResponse: {
      /** Confirmed At */
      confirmed_at: string | null
      /** Created At */
      created_at: string
      /** Filename */
      filename: string
      /** Id */
      id: number
      /**
       * Kind
       * @enum {string}
       */
      kind: 'process' | 'drawing' | 'order'
      /** Parsed */
      parsed:
        | components['schemas']['ParsedReceiptProcessResponse']
        | components['schemas']['RouteOrderDocumentResponse']
        | components['schemas']['ReadResponse']
      /** Sha256 */
      sha256: string
      /** Size Bytes */
      size_bytes: number
      /** Transfer Id */
      transfer_id: number | null
    }
    /** ReceiptDocumentsResponse */
    ReceiptDocumentsResponse: {
      /** Items */
      items: components['schemas']['ReceiptDocumentResponse'][]
    }
    /** ResumeWrite */
    ResumeWrite: {
      /** Expected Revision */
      expected_revision: number
    }
    /** RevisionWrite */
    RevisionWrite: {
      /**
       * Confirmed Imports
       * @default false
       */
      confirmed_imports: boolean
      /** Version */
      version: number
    }
    /** ReworkInspectionReference */
    ReworkInspectionReference: {
      /**
       * Checked At
       * Format: date-time
       */
      checked_at: string
      /** Id */
      id: number
      /**
       * Kind
       * @enum {string}
       */
      kind: 'patrol' | 'inspection'
    }
    /** ReworkInspectionResponse */
    ReworkInspectionResponse: {
      /** Batch No */
      batch_no: string
      /** Checked At */
      checked_at: string
      /** Failed Quantity */
      failed_quantity: number
      /** Id */
      id: number
      /** Inspector Name */
      inspector_name: string
      /** Sample Quantity */
      sample_quantity: number
      /**
       * Scope
       * @enum {string}
       */
      scope: 'sample' | 'full'
    }
    /** ReworkLink */
    ReworkLink: {
      /** Expected Version */
      expected_version: number
      /** Route Id */
      route_id: number
      /** Route Version */
      route_version: number
      /** Schedule Id */
      schedule_id: number
    }
    /** ReworkNoticePageResponse */
    ReworkNoticePageResponse: {
      /** Items */
      items: components['schemas']['ReworkNoticeResponse'][]
      /** Page */
      page: number
      /** Page Size */
      page_size: number
      /** Total */
      total: number
      /** Unread */
      unread: number
    }
    /** ReworkNoticeResponse */
    ReworkNoticeResponse: {
      /** Batch No */
      batch_no: string
      /** Created At */
      created_at: string
      /** Engineering Employee Name */
      engineering_employee_name: string | null
      /** Id */
      id: number
      /**
       * Kind
       * @enum {string}
       */
      kind: 'requested' | 'ready'
      /** Problem */
      problem: string | null
      /** Read At */
      read_at: string | null
      /** Route Id */
      route_id: number
      /** Serial No */
      serial_no: string
      /**
       * State
       * @enum {string}
       */
      state: 'draft' | 'published'
      /** Submitted By */
      submitted_by: string | null
      /** Submitting Team */
      submitting_team: string
    }
    /** ReworkProblemTeamResponse */
    ReworkProblemTeamResponse: {
      /** Id */
      id: number
      /** Name */
      name: string
    }
    /** ReworkProgressResponse */
    ReworkProgressResponse: {
      /** Completed Quantity */
      completed_quantity: number
      /** Inspections */
      inspections: components['schemas']['ReworkInspectionResponse'][]
      /** Passed Quantity */
      passed_quantity: number
      /** Quantity */
      quantity: number
      /**
       * State
       * @enum {string}
       */
      state: 'awaiting_route' | 'processing' | 'awaiting_inspection' | 'passed' | 'failed'
    }
    /** ReworkRequest */
    ReworkRequest: {
      /** Expected Revision */
      expected_revision: number
      /** Idempotency Key */
      idempotency_key: string
      /** Inspection Id */
      inspection_id?: number | null
      /** Quantity */
      quantity: number
      /** Reason */
      reason: string
      /** Rework Of Id */
      rework_of_id: number
      /** Source Transfer Id */
      source_transfer_id: number
      /** Weight */
      weight: number | string
    }
    /** ReworkRequestResponse */
    ReworkRequestResponse: {
      /** Batch No */
      batch_no: string
      /** Can Modify */
      can_modify?: boolean | null
      /** Dimension Result */
      dimension_result: string
      /** Execution Team Names */
      execution_team_names: string[]
      /** Inspection Id */
      inspection_id: number | null
      /** Inspection Kind */
      inspection_kind: ('patrol' | 'inspection') | null
      /** Inspector Name */
      inspector_name: string | null
      /** Original Schedule Id */
      original_schedule_id: number | null
      /** Original Task Id */
      original_task_id: number | null
      /** Problem Names */
      problem_names: string[]
      /** Problem Notes */
      problem_notes: string
      /** Problem Teams */
      problem_teams: components['schemas']['ReworkProblemTeamResponse'][]
      /** Quantity */
      quantity: number
      /** Reason */
      reason: string
      /** Requested By */
      requested_by: string | null
      /** Requesting Team Id */
      requesting_team_id: number | null
      /** Requesting Team Name */
      requesting_team_name: string | null
      /** Resume Route Id */
      resume_route_id: number | null
      /** Resume Step Index */
      resume_step_index: number | null
      /** Resume Step Name */
      resume_step_name: string | null
      /** Resume Team Id */
      resume_team_id: number
      /** Rework Of Id */
      rework_of_id: number
      /** Round */
      round: number
      /** Source Transfer Id */
      source_transfer_id: number
      /** Team Id */
      team_id: number
      /** Team Name */
      team_name: string
      /** Weight */
      weight: number
      /** Weight Result */
      weight_result: string
    }
    /** ReworkResumeResponse */
    ReworkResumeResponse: {
      current: components['schemas']['RouteExecutionContextResponse'] | null
    }
    /** ReworkRoundResponse */
    ReworkRoundResponse: {
      /** Engineering Employee Name */
      engineering_employee_name: string | null
      progress: components['schemas']['ReworkProgressResponse']
      request: components['schemas']['ReworkRequestResponse']
      /** Route Id */
      route_id: number
      /**
       * State
       * @enum {string}
       */
      state: 'draft' | 'published'
      /** Steps */
      steps: components['schemas']['RouteStepResponse'][]
    }
    /** ReworkScheduleOptionResponse */
    ReworkScheduleOptionResponse: {
      /** Due At */
      due_at: string
      /** Id */
      id: number
      /** Team Name */
      team_name: string
    }
    /** ReworkSourceResponse */
    ReworkSourceResponse: {
      /** Batch No */
      batch_no: string
      /** Id */
      id: number
      /** Quantity */
      quantity: number
      /** Serial No */
      serial_no: string
      /** Weight */
      weight: number
    }
    /** ReworkTaskRecordResponse */
    ReworkTaskRecordResponse: {
      /** Process Route Id */
      process_route_id?: number | null
      /** Process Step Index */
      process_step_index?: number | null
      /** Process Step Instructions */
      process_step_instructions?: string | null
      /** Process Step Name */
      process_step_name: string | null
      /** Processing Task Id */
      processing_task_id?: number | null
      /** Processing Task Name */
      processing_task_name: string | null
      /** Purpose Id */
      purpose_id?: number | null
      /** Purpose Name */
      purpose_name?: string | null
      /** Rework Of Id */
      rework_of_id: number
    }
    /** RouteDispatchOrderResponse */
    RouteDispatchOrderResponse: {
      document: components['schemas']['RouteOrderDocumentResponse']
      /** Task Id */
      task_id: number
    }
    /** RouteDraftWrite */
    RouteDraftWrite: {
      /** Engineering Employee Id */
      engineering_employee_id?: number | null
      /** Material Values */
      material_values?: {
        [key: string]: string | number | null
      } | null
      /** Modified Employee Id */
      modified_employee_id?: number | null
      /** Resume Step Index */
      resume_step_index?: number | null
      /**
       * Review Note
       * @default
       */
      review_note: string
      /** Serial Nos */
      serial_nos: string[]
      /** Steps */
      steps: components['schemas']['StepWrite'][]
      /** Title */
      title: string
      /** Version */
      version: number
    }
    /** RouteDrawingResponse */
    RouteDrawingResponse: {
      /** Filename */
      filename: string
      /** Id */
      id: number
      /** Sha256 */
      sha256: string
      /** Size Bytes */
      size_bytes: number
    }
    /** RouteExecutionContextResponse */
    RouteExecutionContextResponse: {
      /** Available */
      available?: boolean | null
      /** Can Resume */
      can_resume: boolean
      /** Complete */
      complete: boolean
      /** Execution Serial */
      execution_serial: string | null
      /** Id */
      id: number
      /** Instructions */
      instructions: string
      /** Next Purpose Id */
      next_purpose_id: number | null
      /** Next Team Id */
      next_team_id: number | null
      /** Processing Task Id */
      processing_task_id: number | null
      /** Purpose Id */
      purpose_id: number | null
      /** Rework Of Id */
      rework_of_id: number | null
      /**
       * Route Kind
       * @enum {string}
       */
      route_kind: 'normal' | 'rework'
      /** Sequence No */
      sequence_no: number
      /** Split Here */
      split_here: boolean
      /** Step Index */
      step_index: number
      /** Step Name */
      step_name: string
      /** Team Id */
      team_id: number
      /** Title */
      title: string
      /** Version */
      version: number
    }
    /** RouteExecutionLabelsResponse */
    RouteExecutionLabelsResponse: {
      /** Purposes */
      purposes: {
        [key: string]: string
      }
      /** Tasks */
      tasks: {
        [key: string]: string
      }
    }
    /** RouteExecutionOptionsResponse */
    RouteExecutionOptionsResponse: {
      /** Purposes */
      purposes: components['schemas']['TeamDirectoryItemResponse'][]
      /** Tasks */
      tasks: components['schemas']['TeamProcessingTaskResponse'][]
    }
    /** RouteIntakeWrite */
    RouteIntakeWrite: {
      /** Id */
      id: number
      /**
       * Review Note
       * @default
       */
      review_note: string
      /** Serial Nos */
      serial_nos: string[]
      /** Steps */
      steps: components['schemas']['StepWrite'][]
      /** Title */
      title: string
      /** Version */
      version: number
    }
    /** RouteLink */
    RouteLink: {
      /** Expected Version */
      expected_version: number
      /** Mappings */
      mappings: components['schemas']['RouteMapping'][]
      /** Route Id */
      route_id: number
      /** Route Version */
      route_version: number
    }
    /** RouteMapping */
    RouteMapping: {
      /** Expected Version */
      expected_version: number
      /** Schedule Id */
      schedule_id: number
      /** Step Index */
      step_index: number
    }
    /** RouteMaterialFieldResponse */
    RouteMaterialFieldResponse: {
      alternative?: components['schemas']['RouteMaterialFieldResponse'] | null
      /** Label */
      label: string
      /** Parsed Value */
      parsed_value?: string | number | null
      /** Source Filename */
      source_filename?: string | null
      /** Source Kind */
      source_kind?: ('word' | 'excel' | 'manual') | null
      /** Source Label */
      source_label: string
      /** Source Row */
      source_row: string
      /** Value */
      value: string | number
    }
    /** RouteOrderDocumentResponse */
    RouteOrderDocumentResponse: {
      /** Display Values */
      display_values?: string[] | null
      /** Filename */
      filename: string
      /** Headers */
      headers: string[]
      /** Receipt Fields */
      receipt_fields: {
        [key: string]: components['schemas']['RouteMaterialFieldResponse']
      }
      /** Serial No */
      serial_no: string
      /** Sheet */
      sheet: string
      /** Values */
      values: string[]
      /** Warnings */
      warnings: string[]
    }
    /** RouteSourceDataResponse */
    RouteSourceDataResponse: {
      /** Field Warnings */
      field_warnings?: string[] | null
      /** Issues */
      issues: string[]
      material_confirmation?: components['schemas']['MaterialConfirmationResponse'] | null
      order_document?: components['schemas']['RouteOrderDocumentResponse'] | null
      /** Original Steps */
      original_steps?: components['schemas']['RouteStepResponse'][] | null
      /** Receipt Fields */
      receipt_fields?: {
        [key: string]: components['schemas']['RouteMaterialFieldResponse']
      } | null
      /** Review Required */
      review_required?: boolean | null
      /** Tables */
      tables: string[][][]
      /** Word Fields */
      word_fields?: {
        [key: string]: components['schemas']['RouteMaterialFieldResponse']
      } | null
    }
    /** RouteStepResponse */
    RouteStepResponse: {
      /** Instructions */
      instructions: string
      /** Name */
      name: string
      /** Planned Days */
      planned_days: string
      /** Planned Quantity */
      planned_quantity: string
      /** Processing Task Id */
      processing_task_id?: number | null
      /** Purpose Id */
      purpose_id?: number | null
      /** Sequence No */
      sequence_no: number
      /** Serial Nos */
      serial_nos: string[]
      /** Source Row */
      source_row?: string | null
      /** Split Here */
      split_here: boolean
      /** Team Id */
      team_id: number | null
      /** Team Name */
      team_name?: string | null
    }
    /** RouteStepSummaryResponse */
    RouteStepSummaryResponse: {
      /** Name */
      name: string
      /** Sequence No */
      sequence_no: number
      /** Team Id */
      team_id: number | null
    }
    /** ScheduleBatchProposalResponse */
    ScheduleBatchProposalResponse: {
      /** Batch Number */
      batch_number: number
      /** Due At */
      due_at: string
      /** Id */
      id?: number | null
      /** Planned Start At */
      planned_start_at?: string | null
      /** Target Quantity */
      target_quantity: number | null
      /** Target Weight */
      target_weight: string | number | null
      /** Upstream Batch Ids */
      upstream_batch_ids: number[]
    }
    /** ScheduleBatchResponse */
    ScheduleBatchResponse: {
      /** Batch Number */
      batch_number: number
      /** Completed At */
      completed_at: string | null
      /** Dispatched Quantity */
      dispatched_quantity: number
      /** Dispatched Weight */
      dispatched_weight: number
      /** Due At */
      due_at: string
      /** Id */
      id: number
      /** Planned Start At */
      planned_start_at: string | null
      /** Received Quantity */
      received_quantity: number
      /** Received Weight */
      received_weight: number
      /**
       * Status
       * @enum {string}
       */
      status:
        | 'pending'
        | 'today'
        | 'overdue'
        | 'completed'
        | 'completed_late'
        | 'cancelled'
        | 'not_assessed'
      /** Target Quantity */
      target_quantity: number | null
      /** Target Weight */
      target_weight: number | null
      /** Upstream Batch Ids */
      upstream_batch_ids: number[]
      /** Warnings */
      warnings: string[]
    }
    /** ScheduleCancel */
    ScheduleCancel: {
      /** Expected Version */
      expected_version: number
      /**
       * Reason
       * @default
       */
      reason: string
    }
    /** ScheduleCandidateResponse */
    ScheduleCandidateResponse: {
      /** Schedules */
      schedules: components['schemas']['ScheduleResponse'][]
      /** Source Transfer Id */
      source_transfer_id: number
    }
    /** ScheduleCandidatesResponse */
    ScheduleCandidatesResponse: {
      /** Items */
      items: components['schemas']['ScheduleCandidateResponse'][]
    }
    /** ScheduleCommitmentUpdate */
    ScheduleCommitmentUpdate: {
      /**
       * Completion Basis
       * @enum {string}
       */
      completion_basis: 'quantity' | 'weight' | 'both'
      /**
       * Due At
       * Format: date-time
       */
      due_at: string
      /** Expected Version */
      expected_version: number
      /** Notes */
      notes?: string | null
      /** Target Quantity */
      target_quantity?: number | null
      /** Target Weight */
      target_weight?: number | string | null
    }
    /** ScheduleCreate */
    ScheduleCreate: {
      /** Completion Basis */
      completion_basis?: ('quantity' | 'weight' | 'both') | null
      /**
       * Due At
       * Format: date-time
       */
      due_at: string
      /** External Destination */
      external_destination?: string | null
      /** Idempotency Key */
      idempotency_key?: string | null
      /** Next Team Id */
      next_team_id?: number | null
      /** Notes */
      notes?: string | null
      /** Predecessor Id */
      predecessor_id?: number | null
      /** Process Route Id */
      process_route_id?: number | null
      /** Process Step Index */
      process_step_index?: number | null
      /**
       * Sequence No
       * @default 1
       */
      sequence_no: number
      /** Serial No */
      serial_no: string
      /** Sources */
      sources?: components['schemas']['ScheduleSource'][]
      /** Target Quantity */
      target_quantity?: number | null
      /** Target Weight */
      target_weight?: number | string | null
      /** Team Id */
      team_id: number
    }
    /** ScheduleDeliveryResponse */
    ScheduleDeliveryResponse: {
      /** Batch No */
      batch_no: string
      /** Counts Toward Delivery */
      counts_toward_delivery: boolean
      /** Id */
      id: number
      /** Quantity */
      quantity: number
      /** Received At */
      received_at: string | null
      /** Schedule Batch Id */
      schedule_batch_id: number | null
      /** Source Transfer Id */
      source_transfer_id: number | null
      /** Status */
      status: string
      /** Transferred At */
      transferred_at: string | null
      /** Weight */
      weight: number
    }
    /** ScheduleDetailResponse */
    ScheduleDetailResponse: {
      /** Assessment Enabled */
      assessment_enabled: boolean
      /** Batches */
      batches: components['schemas']['ScheduleBatchResponse'][]
      /** Cancelled At */
      cancelled_at: string | null
      /** Completed At */
      completed_at: string | null
      /**
       * Completion Basis
       * @enum {string}
       */
      completion_basis: 'quantity' | 'weight' | 'both'
      /** Created At */
      created_at: string
      /** Deliveries */
      deliveries: components['schemas']['ScheduleDeliveryResponse'][]
      /** Delivery Batches */
      delivery_batches: components['schemas']['CustomerDeliveryBatchResponse'][]
      /** Dispatched Quantity */
      dispatched_quantity: number
      /** Dispatched Weight */
      dispatched_weight: number
      /** Due At */
      due_at: string
      /**
       * Execution State
       * @enum {string}
       */
      execution_state:
        | 'cancelled'
        | 'completed'
        | 'stock_dispatched'
        | 'partial'
        | 'ready'
        | 'pending_receipt'
        | 'waiting_material'
      /** External Destination */
      external_destination: string | null
      /** Final Due At */
      final_due_at: string | null
      /** History */
      history: components['schemas']['ScheduleEventResponse'][]
      /** Id */
      id: number
      /** Initial Due At */
      initial_due_at: string
      /** Linked Batch Count */
      linked_batch_count: number
      /** Linked Batches */
      linked_batches: components['schemas']['ScheduleLinkedBatchResponse'][]
      /** Material Name */
      material_name: string | null
      /** Next Team Id */
      next_team_id: number | null
      /** Next Team Name */
      next_team_name: string | null
      /** Notes */
      notes: string | null
      /** Order Locked */
      order_locked: boolean
      /** Pending Batches */
      pending_batches: components['schemas']['ScheduleBatchProposalResponse'][] | null
      /** Planned Start At */
      planned_start_at: string | null
      /**
       * Planning State
       * @enum {string}
       */
      planning_state: 'pending' | 'submitted' | 'revision_pending' | 'confirmed'
      /** Predecessor Id */
      predecessor_id: number | null
      /** Process Route Id */
      process_route_id: number | null
      /** Process Step Index */
      process_step_index: number | null
      /** Processed Quantity */
      processed_quantity: number
      /** Quality Held */
      quality_held: boolean
      /** Received Quantity */
      received_quantity: number
      /** Received Weight */
      received_weight: number
      /** Remaining Quantity */
      remaining_quantity: number | null
      /** Remaining Weight */
      remaining_weight: number | null
      route_link?: components['schemas']['ScheduleRouteLinkResponse'] | null
      /** Sequence No */
      sequence_no: number
      /** Serial No */
      serial_no: string
      /** Sources */
      sources: components['schemas']['ScheduleSourceResponse'][]
      /**
       * Status
       * @enum {string}
       */
      status:
        | 'pending'
        | 'today'
        | 'overdue'
        | 'completed'
        | 'completed_late'
        | 'cancelled'
        | 'not_assessed'
      stock: components['schemas']['ScheduleStockResponse']
      /** Target Quantity */
      target_quantity: number | null
      /** Target Weight */
      target_weight: number | null
      /** Task Id */
      task_id: number
      /** Task No */
      task_no: string
      /** Task Title */
      task_title: string
      /** Team Id */
      team_id: number
      /** Team Name */
      team_name: string
      /** Updated At */
      updated_at: string
      /** Version */
      version: number
    }
    /** ScheduleEventResponse */
    ScheduleEventResponse: {
      /** Action */
      action: string
      /** Actor */
      actor: string
      /** After */
      after: {
        [key: string]: components['schemas']['JsonValue']
      } | null
      /** Before */
      before: {
        [key: string]: components['schemas']['JsonValue']
      } | null
      /** Id */
      id: number
      /** Occurred At */
      occurred_at: string
    }
    /** ScheduleInventoryQuery */
    ScheduleInventoryQuery: {
      /** Group Ids */
      group_ids?: number[]
      /** Source Transfer Ids */
      source_transfer_ids?: number[]
      /** Team Id */
      team_id: number
    }
    /** ScheduleLinkedBatchResponse */
    ScheduleLinkedBatchResponse: {
      /** Batch No */
      batch_no: string
      /** Material Name */
      material_name: string
      /** Quantity */
      quantity: number
      /** Received At */
      received_at: string | null
      /** Source Transfer Id */
      source_transfer_id: number
      /** Status */
      status: string
      /** Weight */
      weight: number
    }
    /** ScheduleLocationResponse */
    ScheduleLocationResponse: {
      /** Batch Count */
      batch_count: number
      /** Pending Quantity */
      pending_quantity: number
      /** Pending Weight */
      pending_weight: number
      /** Quality Held */
      quality_held: boolean
      /** Quantity */
      quantity: number
      /** Team Id */
      team_id: number
      /** Team Name */
      team_name: string
      /** Weight */
      weight: number
    }
    /** ScheduleNoticePageResponse */
    ScheduleNoticePageResponse: {
      /** Items */
      items: components['schemas']['ScheduleNoticeResponse'][]
      /** Latest Id */
      latest_id: number
      /** Total */
      total: number
      /** Unread */
      unread: number
    }
    /** ScheduleNoticeReadAll */
    ScheduleNoticeReadAll: {
      /** Through Id */
      through_id: number
    }
    /** ScheduleNoticeResponse */
    ScheduleNoticeResponse: {
      /** Created At */
      created_at: string
      /** Href */
      href: string
      /** Id */
      id: number
      /**
       * Kind
       * @enum {string}
       */
      kind:
        | 'new'
        | 'changed'
        | 'cancelled'
        | 'upstream'
        | 'final_due'
        | 'due_soon'
        | 'overdue'
        | 'review'
        | 'returned'
        | 'locked'
        | 'unlocked'
      /** Message */
      message: string
      /** Read At */
      read_at: string | null
      /** Serial No */
      serial_no: string
      /** Team Name */
      team_name: string
    }
    /** ScheduleOverviewResponse */
    ScheduleOverviewResponse: {
      /** As Of */
      as_of: string
      /** Assessed Count */
      assessed_count: number
      /** Attention */
      attention: components['schemas']['ScheduleResponse'][]
      /** Date From */
      date_from: string
      /** Date To */
      date_to: string
      /** On Time Rate */
      on_time_rate: number | null
      /** Overdue Count */
      overdue_count: number
      period: components['schemas']['SchedulePeriodResponse']
      /** Today Count */
      today_count: number
    }
    /** SchedulePeriodResponse */
    SchedulePeriodResponse: {
      /** Completed */
      completed: number
      /** Completed Late */
      completed_late: number
      /** Overdue */
      overdue: number
    }
    /** SchedulePersonResponse */
    SchedulePersonResponse: {
      /** Id */
      id: number
      /** Name */
      name: string
    }
    /** ScheduleResponse */
    ScheduleResponse: {
      /** Assessment Enabled */
      assessment_enabled: boolean
      /** Batches */
      batches: components['schemas']['ScheduleBatchResponse'][]
      /** Cancelled At */
      cancelled_at: string | null
      /** Completed At */
      completed_at: string | null
      /**
       * Completion Basis
       * @enum {string}
       */
      completion_basis: 'quantity' | 'weight' | 'both'
      /** Created At */
      created_at: string
      /** Delivery Batches */
      delivery_batches: components['schemas']['CustomerDeliveryBatchResponse'][]
      /** Dispatched Quantity */
      dispatched_quantity: number
      /** Dispatched Weight */
      dispatched_weight: number
      /** Due At */
      due_at: string
      /**
       * Execution State
       * @enum {string}
       */
      execution_state:
        | 'cancelled'
        | 'completed'
        | 'stock_dispatched'
        | 'partial'
        | 'ready'
        | 'pending_receipt'
        | 'waiting_material'
      /** External Destination */
      external_destination: string | null
      /** Final Due At */
      final_due_at: string | null
      /** Id */
      id: number
      /** Initial Due At */
      initial_due_at: string
      /** Linked Batch Count */
      linked_batch_count: number
      /** Linked Batches */
      linked_batches: components['schemas']['ScheduleLinkedBatchResponse'][]
      /** Material Name */
      material_name: string | null
      /** Next Team Id */
      next_team_id: number | null
      /** Next Team Name */
      next_team_name: string | null
      /** Notes */
      notes: string | null
      /** Order Locked */
      order_locked: boolean
      /** Pending Batches */
      pending_batches: components['schemas']['ScheduleBatchProposalResponse'][] | null
      /** Planned Start At */
      planned_start_at: string | null
      /**
       * Planning State
       * @enum {string}
       */
      planning_state: 'pending' | 'submitted' | 'revision_pending' | 'confirmed'
      /** Predecessor Id */
      predecessor_id: number | null
      /** Process Route Id */
      process_route_id: number | null
      /** Process Step Index */
      process_step_index: number | null
      /** Processed Quantity */
      processed_quantity: number
      /** Quality Held */
      quality_held: boolean
      /** Received Quantity */
      received_quantity: number
      /** Received Weight */
      received_weight: number
      /** Remaining Quantity */
      remaining_quantity: number | null
      /** Remaining Weight */
      remaining_weight: number | null
      route_link?: components['schemas']['ScheduleRouteLinkResponse'] | null
      /** Sequence No */
      sequence_no: number
      /** Serial No */
      serial_no: string
      /** Sources */
      sources: components['schemas']['ScheduleSourceResponse'][]
      /**
       * Status
       * @enum {string}
       */
      status:
        | 'pending'
        | 'today'
        | 'overdue'
        | 'completed'
        | 'completed_late'
        | 'cancelled'
        | 'not_assessed'
      stock: components['schemas']['ScheduleStockResponse']
      /** Target Quantity */
      target_quantity: number | null
      /** Target Weight */
      target_weight: number | null
      /** Task Id */
      task_id: number
      /** Task No */
      task_no: string
      /** Task Title */
      task_title: string
      /** Team Id */
      team_id: number
      /** Team Name */
      team_name: string
      /** Updated At */
      updated_at: string
      /** Version */
      version: number
    }
    /** ScheduleReworkOptionResponse */
    ScheduleReworkOptionResponse: {
      /** Batch No */
      batch_no: string
      /** Plans */
      plans: components['schemas']['ReworkScheduleOptionResponse'][]
      /** Problem */
      problem: string
      /** Route Id */
      route_id: number
      /** Route Version */
      route_version: number
    }
    /** ScheduleReworkResponse */
    ScheduleReworkResponse: {
      /** Batch No */
      batch_no: string
      /** Completed Quantity */
      completed_quantity: number
      /** Problem */
      problem: string
      /** Quantity */
      quantity: number
      /** Route Id */
      route_id: number
      /** Route Version */
      route_version: number
      /** Schedule Id */
      schedule_id: number
      /**
       * State
       * @enum {string}
       */
      state: 'awaiting_route' | 'processing' | 'processed'
    }
    /** ScheduleRouteLinkResponse */
    ScheduleRouteLinkResponse: {
      /** Latest Route Id */
      latest_route_id: number | null
      /**
       * State
       * @enum {string}
       */
      state: 'unlinked' | 'linked' | 'changed'
    }
    /** ScheduleRouteOptionResponse */
    ScheduleRouteOptionResponse: {
      /** Execution Serial */
      execution_serial: string | null
      /** Id */
      id: number
      /** Published At */
      published_at: string
      /** Serial Nos */
      serial_nos: string[]
      /** Steps */
      steps: components['schemas']['RouteStepResponse'][]
      /** Title */
      title: string
      /** Version */
      version: number
    }
    /** ScheduleSerialOptionResponse */
    ScheduleSerialOptionResponse: {
      /** Serial No */
      serial_no: string
      /** Task Count */
      task_count: number
    }
    /** ScheduleSource */
    ScheduleSource: {
      /** Quantity */
      quantity?: number | null
      /** Source Transfer Id */
      source_transfer_id: number
      /** Weight */
      weight?: number | string | null
    }
    /** ScheduleSourceOptionResponse */
    ScheduleSourceOptionResponse: {
      /** Batch No */
      batch_no: string
      /** Material Name */
      material_name: string
      /** Material Type */
      material_type: string
      /** On Hand Quantity */
      on_hand_quantity: number
      /** On Hand Weight */
      on_hand_weight: number
      /** Quantity */
      quantity: number
      /** Received At */
      received_at: string | null
      /** Serial No */
      serial_no: string
      /** Source Transfer Id */
      source_transfer_id: number
      /** Weight */
      weight: number
    }
    /** ScheduleSourceResponse */
    ScheduleSourceResponse: {
      /** Batch No */
      batch_no: string
      /** Material Name */
      material_name: string
      /** Quantity */
      quantity: number | null
      /** Source Transfer Id */
      source_transfer_id: number
      /** Weight */
      weight: number | null
    }
    /** ScheduleStockResponse */
    ScheduleStockResponse: {
      /** Batch Count */
      batch_count: number
      /** On Hand Quantity */
      on_hand_quantity: number
      /** On Hand Weight */
      on_hand_weight: number
      /** Pending Quantity */
      pending_quantity: number
      /** Pending Weight */
      pending_weight: number
      /** Rework Quantity */
      rework_quantity: number
    }
    /** ScheduleTaskDetailResponse */
    ScheduleTaskDetailResponse: {
      /** Business People */
      business_people: components['schemas']['SchedulePersonResponse'][]
      /** Business Person Id */
      business_person_id: number | null
      /** Business Person Name */
      business_person_name: string | null
      /** Cancelled At */
      cancelled_at: string | null
      /** Created At */
      created_at: string
      /** Delivery Batches */
      delivery_batches: components['schemas']['CustomerDeliveryBatchResponse'][]
      /** Final Due At */
      final_due_at: string | null
      /** Id */
      id: number
      /** Locations */
      locations: components['schemas']['ScheduleLocationResponse'][]
      /** Locked At */
      locked_at: string | null
      /** Nodes */
      nodes: components['schemas']['ScheduleResponse'][]
      /** Notes */
      notes: string | null
      order_document: components['schemas']['RouteOrderDocumentResponse'] | null
      /** Reworks */
      reworks: components['schemas']['ScheduleReworkResponse'][]
      /** Route Changed */
      route_changed: boolean
      /** Serial No */
      serial_no: string
      /** Shared Source */
      shared_source: boolean
      /**
       * Status
       * @enum {string}
       */
      status:
        | 'pending'
        | 'today'
        | 'overdue'
        | 'completed'
        | 'completed_late'
        | 'cancelled'
        | 'not_assessed'
      /** Task No */
      task_no: string
      /** Title */
      title: string
      /** Updated At */
      updated_at: string
      /** Version */
      version: number
    }
    /** ScheduleTaskResponse */
    ScheduleTaskResponse: {
      /** Business People */
      business_people: components['schemas']['SchedulePersonResponse'][]
      /** Business Person Id */
      business_person_id: number | null
      /** Business Person Name */
      business_person_name: string | null
      /** Cancelled At */
      cancelled_at: string | null
      /** Created At */
      created_at: string
      /** Delivery Batches */
      delivery_batches: components['schemas']['CustomerDeliveryBatchResponse'][]
      /** Final Due At */
      final_due_at: string | null
      /** Id */
      id: number
      /** Locations */
      locations: components['schemas']['ScheduleLocationResponse'][]
      /** Locked At */
      locked_at: string | null
      /** Nodes */
      nodes: components['schemas']['ScheduleResponse'][]
      /** Notes */
      notes: string | null
      /** Reworks */
      reworks: components['schemas']['ScheduleReworkResponse'][]
      /** Route Changed */
      route_changed: boolean
      /** Serial No */
      serial_no: string
      /** Shared Source */
      shared_source: boolean
      /**
       * Status
       * @enum {string}
       */
      status:
        | 'pending'
        | 'today'
        | 'overdue'
        | 'completed'
        | 'completed_late'
        | 'cancelled'
        | 'not_assessed'
      /** Task No */
      task_no: string
      /** Title */
      title: string
      /** Updated At */
      updated_at: string
      /** Version */
      version: number
    }
    /** ScheduleTaskUpdate */
    ScheduleTaskUpdate: {
      /** Business Person Id */
      business_person_id?: number | null
      /** Business Person Ids */
      business_person_ids?: number[]
      /** Delivery Batches */
      delivery_batches?: components['schemas']['CustomerBatch'][]
      /** Expected Version */
      expected_version: number
      /** Final Due At */
      final_due_at?: string | null
      /** Notes */
      notes?: string | null
      /** Planned Quantity */
      planned_quantity?: number | null
      /** Title */
      title: string
    }
    /** ScheduleUpdate */
    ScheduleUpdate: {
      /** Completion Basis */
      completion_basis?: ('quantity' | 'weight' | 'both') | null
      /**
       * Due At
       * Format: date-time
       */
      due_at: string
      /** Expected Version */
      expected_version: number
      /** External Destination */
      external_destination?: string | null
      /** Idempotency Key */
      idempotency_key?: string | null
      /** Next Team Id */
      next_team_id?: number | null
      /** Notes */
      notes?: string | null
      /** Predecessor Id */
      predecessor_id?: number | null
      /** Process Route Id */
      process_route_id?: number | null
      /** Process Step Index */
      process_step_index?: number | null
      /**
       * Sequence No
       * @default 1
       */
      sequence_no: number
      /** Serial No */
      serial_no: string
      /** Sources */
      sources?: components['schemas']['ScheduleSource'][]
      /** Target Quantity */
      target_quantity?: number | null
      /** Target Weight */
      target_weight?: number | string | null
      /** Team Id */
      team_id: number
    }
    /** SerialHistory */
    SerialHistory: {
      /** Closing At */
      closing_at: string
      /** Date From */
      date_from: string | null
      /** Date To */
      date_to: string | null
      /** Flows */
      flows: components['schemas']['SerialHistoryFlow'][]
      /** Found */
      found: boolean
      /** Groups */
      groups: components['schemas']['SerialHistoryGroup'][]
      /** Lots */
      lots: components['schemas']['SerialHistoryLot'][]
      /** Observed At */
      observed_at: string
      /** Pending Incoming Count */
      pending_incoming_count: number
      /** Serial No */
      serial_no: string
      /** Team Name */
      team_name: string
      /** Untracked Count */
      untracked_count: number
    }
    /** SerialHistoryEvent */
    SerialHistoryEvent: {
      /** At */
      at: string
      /** Balance Quantity */
      balance_quantity: number
      /** Balance Weight */
      balance_weight: number
      /** Batch No */
      batch_no: string
      /** Counterpart */
      counterpart: string | null
      /** Delta Quantity */
      delta_quantity: number
      /** Delta Weight */
      delta_weight: number
      /** Entry Kind */
      entry_kind: string
      /** Id */
      id: string
      /**
       * Kind
       * @enum {string}
       */
      kind:
        | 'incoming'
        | 'opening'
        | 'outgoing'
        | 'adjusted'
        | 'voided'
        | 'loss'
        | 'quantity_changed'
        | 'processing_input'
        | 'processing_output'
      /** Material Type */
      material_type: string | null
      /** Processing Role */
      processing_role: string | null
      /** Quantity */
      quantity: number
      /** Source Batch No */
      source_batch_no: string
      /** Source Material Type */
      source_material_type: string | null
      /** Status */
      status: string
      /** Transfer Specification */
      transfer_specification: string | null
      /** Weight */
      weight: number
    }
    /** SerialHistoryFlow */
    SerialHistoryFlow: {
      /** At */
      at: string
      /** Batch No */
      batch_no: string
      /**
       * Direction
       * @enum {string}
       */
      direction: 'incoming' | 'outgoing'
      /** Entry Kind */
      entry_kind: string
      /** From Name */
      from_name: string
      /** Group Key */
      group_key: string
      /** Id */
      id: string
      /** Quantity */
      quantity: number
      /** Status */
      status: string
      /** To Name */
      to_name: string
      /** Weight */
      weight: number
    }
    /** SerialHistoryGroup */
    SerialHistoryGroup: {
      /** Baseline Quantity */
      baseline_quantity: number
      /** Baseline Weight */
      baseline_weight: number
      /** Events */
      events: components['schemas']['SerialHistoryEvent'][]
      /** Incoming Quantity */
      incoming_quantity: number
      /** Incoming Weight */
      incoming_weight: number
      /** Key */
      key: string
      /** Lost Quantity */
      lost_quantity: number
      /** Lost Weight */
      lost_weight: number
      /** Name */
      name: string
      /** On Hand Quantity */
      on_hand_quantity: number
      /** On Hand Weight */
      on_hand_weight: number
      /** Outgoing Quantity */
      outgoing_quantity: number
      /** Outgoing Weight */
      outgoing_weight: number
      /** Owned Quantity */
      owned_quantity: number
      /** Owned Weight */
      owned_weight: number
      /** Processing Delta Quantity */
      processing_delta_quantity: number
      /** Processing Delta Weight */
      processing_delta_weight: number
      /** Purpose Id */
      purpose_id: number | null
    }
    /** SerialHistoryLot */
    SerialHistoryLot: {
      /** Baseline Quantity */
      baseline_quantity: number
      /** Baseline Weight */
      baseline_weight: number
      /** Batch No */
      batch_no: string
      /** Closing Quantity */
      closing_quantity: number
      /** Closing Weight */
      closing_weight: number
      /** Entry Kind */
      entry_kind: string
      /** From Name */
      from_name: string
      /** Group Key */
      group_key: string
      /** Last Event At */
      last_event_at: string
      /** Material Type */
      material_type: string | null
      /** On Hand Quantity */
      on_hand_quantity: number
      /** On Hand Weight */
      on_hand_weight: number
      /** Owned Quantity */
      owned_quantity: number
      /** Owned Weight */
      owned_weight: number
      /** Processing Role */
      processing_role: string | null
      /** Quantity */
      quantity: number
      /** Received At */
      received_at: string
      /** Source Batch No */
      source_batch_no: string | null
      /** Transfer Specification */
      transfer_specification: string | null
      /** Weight */
      weight: number
    }
    /** SerialInventoryBatchResponse */
    SerialInventoryBatchResponse: {
      /** Batch No */
      batch_no: string
      /** Id */
      id: number
      /** Inspection Hold Id */
      inspection_hold_id: number | null
      /**
       * Location
       * @enum {string}
       */
      location: 'stock' | 'incoming'
      /** Material Name */
      material_name: string
      /** Material Type */
      material_type: string
      /** Quantity */
      quantity: number
      /** Rework Count */
      rework_count: number
      /** Rework Pending */
      rework_pending: boolean
      /** Shared Unallocated */
      shared_unallocated: boolean
      /** Team Id */
      team_id: number
      /** Transfer Specification */
      transfer_specification: string | null
      /** Weight */
      weight: number
    }
    /** SerialInventoryResponse */
    SerialInventoryResponse: {
      /** As Of */
      as_of: string
      /** Items */
      items: components['schemas']['SerialInventoryRowResponse'][]
      /** Serial No */
      serial_no: string
      /** Untracked Count */
      untracked_count: number
    }
    /** SerialInventoryRowResponse */
    SerialInventoryRowResponse: {
      /** Incoming Quantity */
      incoming_quantity: number
      /** Incoming Weight */
      incoming_weight: number
      /** Material Name */
      material_name: string
      /** Material Type */
      material_type: string
      /** Shared Unallocated */
      shared_unallocated: boolean
      /** Stock Quantity */
      stock_quantity: number
      /** Stock Weight */
      stock_weight: number
      /** Team Id */
      team_id: number
      /** Team Name */
      team_name: string
    }
    /** SerialSummaryResponse */
    SerialSummaryResponse: {
      /** Adjusted Quantity */
      adjusted_quantity: number
      /** Adjusted Weight */
      adjusted_weight: number
      /** Available Quantity */
      available_quantity: number
      /** Available Weight */
      available_weight: number
      /** Customer Code */
      customer_code: string | null
      /** Customer Code Count */
      customer_code_count: number
      /** Dispatched Quantity */
      dispatched_quantity: number
      /** Dispatched Weight */
      dispatched_weight: number
      /** External Pending Quantity */
      external_pending_quantity: number
      /** External Pending Weight */
      external_pending_weight: number
      /** Finished Quantity */
      finished_quantity: number | null
      /** Finished Quantity Count */
      finished_quantity_count: number
      /** Finished Specification */
      finished_specification: string | null
      /** Finished Specification Count */
      finished_specification_count: number
      /** In Transit Quantity */
      in_transit_quantity: number
      /** In Transit Weight */
      in_transit_weight: number
      /** Last Activity At */
      last_activity_at: string | null
      /** Lost Quantity */
      lost_quantity: number
      /** Lost Weight */
      lost_weight: number
      /** Material Name */
      material_name: string | null
      /** Material Name Count */
      material_name_count: number
      /** Material Type */
      material_type: string | null
      /** Material Type Count */
      material_type_count: number
      /** On Hand Quantity */
      on_hand_quantity: number
      /** On Hand Weight */
      on_hand_weight: number
      /** Owned Quantity */
      owned_quantity: number
      /** Owned Weight */
      owned_weight: number
      /** Pending Incoming Quantity */
      pending_incoming_quantity: number
      /** Pending Incoming Weight */
      pending_incoming_weight: number
      /** Pending Outgoing Quantity */
      pending_outgoing_quantity: number
      /** Pending Outgoing Weight */
      pending_outgoing_weight: number
      /** Product Code */
      product_code: string | null
      /** Product Code Count */
      product_code_count: number
      /** Received Quantity */
      received_quantity: number
      /** Received Weight */
      received_weight: number
      /** Reserved Quantity */
      reserved_quantity: number
      /** Reserved Weight */
      reserved_weight: number
      /** Scrap Available Quantity */
      scrap_available_quantity: number
      /** Scrap Available Weight */
      scrap_available_weight: number
      /** Scrap Quantity */
      scrap_quantity: number
      /** Scrap Weight */
      scrap_weight: number
      /** Serial No */
      serial_no: string
      /** Shortage Quantity */
      shortage_quantity: number
      /** Shortage Weight */
      shortage_weight: number
      /** Source Batch No */
      source_batch_no: string | null
      /** Source Batch No Count */
      source_batch_no_count: number
      /** Transfer Specification */
      transfer_specification: string | null
      /** Transfer Specification Count */
      transfer_specification_count: number
      urgency: components['schemas']['UrgencyResponse']
    }
    /** SerialYieldResponse */
    SerialYieldResponse: {
      /** Current Weight */
      current_weight: number
      /** Input Weight */
      input_weight: number
      /** Lost Weight */
      lost_weight: number
      /** Material */
      material: string
      /** Max Weight Difference */
      max_weight_difference: number
      /** Output Weight */
      output_weight: number
      /** Processing Delta Weight */
      processing_delta_weight: number
      /** Rate */
      rate: number | null
      /** Reallocated In Weight */
      reallocated_in_weight: number
      /** Reallocated Out Weight */
      reallocated_out_weight: number
      /** Serial No */
      serial_no: string
      /** Shared Allocated Weight */
      shared_allocated_weight: number
      /**
       * Status
       * @enum {string}
       */
      status: 'complete' | 'in_progress' | 'needs_review'
      /** Weight Difference */
      weight_difference: number
    }
    /** SharedMaterialSerial */
    'SharedMaterialSerial-Input': {
      /** Customer Code */
      customer_code?: string | null
      /** Delivery Date */
      delivery_date?: string | null
      /** Delivery Quantity */
      delivery_quantity?: number | null
      /** Finished Specification */
      finished_specification?: string | null
      /** Planned Quantity */
      planned_quantity?: number | null
      /** Planned Specification */
      planned_specification?: string | null
      /** Planned Weight */
      planned_weight?: number | string | null
      /** Process Route Id */
      process_route_id?: number | null
      /** Process Route Version */
      process_route_version?: number | null
      /** Serial No */
      serial_no: string
    }
    /** SharedMaterialSerial */
    'SharedMaterialSerial-Output': {
      /** Customer Code */
      customer_code?: string | null
      /** Delivery Date */
      delivery_date?: string | null
      /** Delivery Quantity */
      delivery_quantity?: number | null
      /** Finished Specification */
      finished_specification?: string | null
      /** Planned Quantity */
      planned_quantity?: number | null
      /** Planned Specification */
      planned_specification?: string | null
      /** Planned Weight */
      planned_weight?: string | null
      /** Process Route Id */
      process_route_id?: number | null
      /** Process Route Version */
      process_route_version?: number | null
      /** Serial No */
      serial_no: string
    }
    /** SharedSerialResponse */
    SharedSerialResponse: {
      /** Customer Code */
      customer_code?: string | null
      /** Delivery Date */
      delivery_date?: string | null
      /** Delivery Quantity */
      delivery_quantity?: number | null
      /** Finished Specification */
      finished_specification?: string | null
      /** Planned Quantity */
      planned_quantity?: number | null
      /** Planned Specification */
      planned_specification?: string | null
      /** Planned Weight */
      planned_weight?: number | null
      /** Process Route Id */
      process_route_id?: number | null
      /** Process Route Version */
      process_route_version?: number | null
      /** Serial No */
      serial_no: string
    }
    /** ShipmentSeriesResponse */
    ShipmentSeriesResponse: {
      /** Created At */
      created_at: string
      /** Serial No */
      serial_no: string
      /** Values */
      values: (number | null)[]
    }
    /** ShipmentsResponse */
    ShipmentsResponse: {
      /** Dates */
      dates: string[]
      /** Series */
      series: components['schemas']['ShipmentSeriesResponse'][]
    }
    /** ShipmentStockItemResponse */
    ShipmentStockItemResponse: {
      /** Batch No */
      batch_no: string
      /** Id */
      id: number
      /** Quantity */
      quantity: number
      /** Weight */
      weight: number
    }
    /** ShipmentStockResponse */
    ShipmentStockResponse: {
      /** Items */
      items: components['schemas']['ShipmentStockItemResponse'][]
      /** Quantity */
      quantity: number
      /** Revision */
      revision: string
      /** Weight */
      weight: number
    }
    /** ShipmentTotal */
    ShipmentTotal: {
      /** Group Id */
      group_id: number
      /** Quantity */
      quantity: number
      /** Revision */
      revision: string
      /** Weight */
      weight: number | string
    }
    /** StepWrite */
    StepWrite: {
      /** Instructions */
      instructions: string
      /** Name */
      name: string
      /**
       * Planned Days
       * @default
       */
      planned_days: string
      /**
       * Planned Quantity
       * @default
       */
      planned_quantity: string
      /** Processing Task Id */
      processing_task_id?: number | null
      /** Purpose Id */
      purpose_id?: number | null
      /** Sequence No */
      sequence_no: number
      /** Serial Nos */
      serial_nos?: string[]
      /** Source Row */
      source_row?: string | null
      /**
       * Split Here
       * @default false
       */
      split_here: boolean
      /** Team Id */
      team_id?: number | null
      /** Team Name */
      team_name?: string | null
    }
    /** StockAttentionResponse */
    StockAttentionResponse: {
      /** Batch No */
      batch_no: string
      /** Quantity */
      quantity: number
      /** Received At */
      received_at: string
      /** Serial No */
      serial_no: string | null
      /** Team Id */
      team_id: number
      /** Team Name */
      team_name: string
      /** Transfer Id */
      transfer_id: number
      /** Weight */
      weight: number
    }
    /** StockBalanceResponse */
    StockBalanceResponse: {
      /** Adjusted Quantity */
      adjusted_quantity: number
      /** Adjusted Weight */
      adjusted_weight: number
      /** Available Quantity */
      available_quantity: number
      /** Available Weight */
      available_weight: number
      /** Dispatched Quantity */
      dispatched_quantity: number
      /** Dispatched Weight */
      dispatched_weight: number
      /** External Pending Quantity */
      external_pending_quantity: number
      /** External Pending Weight */
      external_pending_weight: number
      /** In Transit Quantity */
      in_transit_quantity: number
      /** In Transit Weight */
      in_transit_weight: number
      /** Lost Quantity */
      lost_quantity: number
      /** Lost Weight */
      lost_weight: number
      /** On Hand Quantity */
      on_hand_quantity: number
      /** On Hand Weight */
      on_hand_weight: number
      /** Owned Quantity */
      owned_quantity: number
      /** Owned Weight */
      owned_weight: number
      /** Received Quantity */
      received_quantity: number
      /** Received Weight */
      received_weight: number
      /** Reserved Quantity */
      reserved_quantity: number
      /** Reserved Weight */
      reserved_weight: number
      /** Scrap Available Quantity */
      scrap_available_quantity: number
      /** Scrap Available Weight */
      scrap_available_weight: number
      /** Scrap Quantity */
      scrap_quantity: number
      /** Scrap Weight */
      scrap_weight: number
      /** Shortage Quantity */
      shortage_quantity: number
      /** Shortage Weight */
      shortage_weight: number
    }
    /** StockBatchResponse */
    StockBatchResponse: {
      /** Adjusted Quantity */
      adjusted_quantity: number
      /** Adjusted Weight */
      adjusted_weight: number
      /** Available Quantity */
      available_quantity: number
      /** Available Weight */
      available_weight: number
      /** Current Specification */
      current_specification: string | null
      /** Dispatched Quantity */
      dispatched_quantity: number
      /** Dispatched Weight */
      dispatched_weight: number
      /** External Pending Quantity */
      external_pending_quantity: number
      /** External Pending Weight */
      external_pending_weight: number
      /** In Transit Quantity */
      in_transit_quantity: number
      /** In Transit Weight */
      in_transit_weight: number
      /** Inspection Hold Id */
      inspection_hold_id: number | null
      /** Lost Quantity */
      lost_quantity: number
      /** Lost Weight */
      lost_weight: number
      /** On Hand Quantity */
      on_hand_quantity: number
      /** On Hand Weight */
      on_hand_weight: number
      /** Owned Quantity */
      owned_quantity: number
      /** Owned Weight */
      owned_weight: number
      /** Physical Quantity */
      physical_quantity?: number | null
      /** Physical Weight */
      physical_weight?: number | null
      /**
       * Processing State
       * @enum {string}
       */
      processing_state:
        | 'registered'
        | 'partial'
        | 'complete'
        | 'unregistered'
        | 'rework'
        | 'pending'
        | 'cleared'
        | 'not_applicable'
      /** Received Quantity */
      received_quantity: number
      /** Received Weight */
      received_weight: number
      /** Reserved Quantity */
      reserved_quantity: number
      /** Reserved Weight */
      reserved_weight: number
      /** Scrap Available Quantity */
      scrap_available_quantity: number
      /** Scrap Available Weight */
      scrap_available_weight: number
      /** Scrap Quantity */
      scrap_quantity: number
      /** Scrap Weight */
      scrap_weight: number
      /** Shortage Quantity */
      shortage_quantity: number
      /** Shortage Weight */
      shortage_weight: number
      /** Sludge Available Gross Weight */
      sludge_available_gross_weight?: number | null
      transfer: components['schemas']['MaterialTransferResponse']
      /** Unassigned Quantity */
      unassigned_quantity?: number | null
      /** Unassigned Weight */
      unassigned_weight?: number | null
      /** Warehouse Positions */
      warehouse_positions?: components['schemas']['StockPositionResponse'][] | null
      /** Weight Difference */
      weight_difference?: number | null
      /** Weight Root Transfer Id */
      weight_root_transfer_id?: number | null
    }
    /** StockMovementsResponse */
    StockMovementsResponse: {
      /** As Of */
      as_of: string
      /** Items */
      items: components['schemas']['MaterialTransferResponse'][]
      /** Page */
      page: number
      /** Page Size */
      page_size: number
      /** Total */
      total: number
    }
    /** StockPageResponse */
    StockPageResponse: {
      /** As Of */
      as_of: string
      /** Items */
      items: components['schemas']['StockBatchResponse'][]
      /** Page */
      page: number
      /** Page Size */
      page_size: number
      /** Total */
      total: number
    }
    /** StockPositionResponse */
    StockPositionResponse: {
      /** Location Id */
      location_id: number
      /** Name */
      name: string
      /** Quantity */
      quantity: number
      /** Weight */
      weight: number
    }
    /** StockProcessingResponse */
    StockProcessingResponse: {
      /** Batch Count */
      batch_count: number
      /** Quantity */
      quantity: number
      /**
       * State
       * @enum {string}
       */
      state:
        | 'unregistered'
        | 'partial'
        | 'complete'
        | 'rework'
        | 'registered'
        | 'not_required'
        | 'not_applicable'
      /** Weight */
      weight: number
    }
    /** StockRankingResponse */
    StockRankingResponse: {
      /** Quantity */
      quantity: components['schemas']['ChartPointResponse'][]
      /** Weight */
      weight: components['schemas']['ChartPointResponse'][]
    }
    /** TaskDelete */
    TaskDelete: {
      /** Expected Version */
      expected_version: number
    }
    /** TaskLock */
    TaskLock: {
      /** Expected Version */
      expected_version: number
      /** Locked */
      locked: boolean
    }
    /** TeamCreate */
    TeamCreate: {
      /**
       * Active
       * @default true
       */
      active: boolean
      /** Code */
      code: string
      /** Description */
      description?: string | null
      /**
       * Kind
       * @default production
       */
      kind: string
      /** Name */
      name: string
      /**
       * Sort Order
       * @default 0
       */
      sort_order: number
    }
    /** TeamDirectoryItemResponse */
    TeamDirectoryItemResponse: {
      /** Active */
      active: boolean
      /** Id */
      id: number
      /** Name */
      name: string
      /** Team Id */
      team_id: number
      /** Version */
      version: number
    }
    /** TeamInventoryPageResponse */
    TeamInventoryPageResponse: {
      /** As Of */
      as_of: string
      /** Items */
      items: components['schemas']['InventoryGroupResponse'][]
      /** Page */
      page: number
      /** Page Size */
      page_size: number
      /** Total */
      total: number
    }
    /** TeamIssueResponse */
    TeamIssueResponse: {
      /** Issue Count */
      issue_count: number
      /** Team Id */
      team_id: number
      /** Team Name */
      team_name: string
      /** Unresolved Count */
      unresolved_count: number
    }
    /** TeamMaterialOverviewResponse */
    TeamMaterialOverviewResponse: {
      /** As Of */
      as_of: string
      current_stock?: components['schemas']['CurrentStockResponse'] | null
      /** Legacy Received Count */
      legacy_received_count: number
      /** Material Types */
      material_types: components['schemas']['MaterialTypeBalanceResponse'][]
      /** Materials */
      materials: components['schemas']['MaterialBalanceResponse'][]
      pending_incoming: components['schemas']['TeamPendingResponse']
      /** Team Id */
      team_id: number
      totals: components['schemas']['StockBalanceResponse']
      work_orders?: components['schemas']['TeamWorkOrdersResponse'] | null
    }
    /** TeamPeersResponse */
    TeamPeersResponse: {
      /** Incoming */
      incoming: components['schemas']['ChartPointResponse'][]
      /** Outgoing */
      outgoing: components['schemas']['ChartPointResponse'][]
    }
    /** TeamPendingResponse */
    TeamPendingResponse: {
      /** Batch Count */
      batch_count?: number | null
      /** Count */
      count: number
      /** Quantity */
      quantity: number
      /** Weight */
      weight: number
    }
    /** TeamProcessingTaskResponse */
    TeamProcessingTaskResponse: {
      /** Active */
      active: boolean
      /** Id */
      id: number
      /** Name */
      name: string
      /** Purpose Id */
      purpose_id: number | null
      /** Team Id */
      team_id: number
      /** Version */
      version: number
    }
    /** TeamProductionResponse */
    TeamProductionResponse: {
      /** Completed Quantity */
      completed_quantity: number
      /** Completed Weight */
      completed_weight: number
      /** Initial Record Count */
      initial_record_count: number
      /** Record Count */
      record_count: number
      /** Rework Quantity */
      rework_quantity: number
      /** Rework Record Count */
      rework_record_count: number
      /** Rework Weight */
      rework_weight: number
      /** Team Id */
      team_id: number
      /** Team Name */
      team_name: string
      /** Work Quantity */
      work_quantity: number
      /** Work Weight */
      work_weight: number
    }
    /** TeamResponse */
    TeamResponse: {
      /** Active */
      active: boolean
      /** Code */
      code: string
      /**
       * Created At
       * Format: date-time
       */
      created_at: string
      /** Description */
      description: string | null
      /** Id */
      id: number
      /** Kind */
      kind: string
      /** Name */
      name: string
      /**
       * Opening Stock Enabled
       * @default false
       */
      opening_stock_enabled: boolean
      /** Sort Order */
      sort_order: number
      /**
       * Updated At
       * Format: date-time
       */
      updated_at: string
    }
    /** TeamTrendResponse */
    TeamTrendResponse: {
      incoming: components['schemas']['ChartAmountResponse']
      /** Key */
      key: string
      loss: components['schemas']['ChartAmountResponse']
      outgoing: components['schemas']['ChartAmountResponse']
    }
    /** TeamUpdate */
    TeamUpdate: {
      /** Active */
      active?: boolean | null
      /** Code */
      code?: string | null
      /** Description */
      description?: string | null
      /** Kind */
      kind?: string | null
      /** Name */
      name?: string | null
      /** Sort Order */
      sort_order?: number | null
    }
    /** TeamWaitingAgeResponse */
    TeamWaitingAgeResponse: {
      incoming: components['schemas']['ChartAmountResponse']
      /** Key */
      key: string
      /** Label */
      label: string
      outgoing: components['schemas']['ChartAmountResponse']
    }
    /** TeamWorkOrdersResponse */
    TeamWorkOrdersResponse: {
      /** In Progress Count */
      in_progress_count: number
      /**
       * Mode
       * @enum {string}
       */
      mode: 'processing' | 'handling'
      /** Overdue Count */
      overdue_count: number | null
      /** Periods */
      periods: components['schemas']['TeamWorkPeriodResponse'][]
    }
    /** TeamWorkPeriodResponse */
    TeamWorkPeriodResponse: {
      /** Completed Count */
      completed_count: number
      /**
       * Date From
       * Format: date
       */
      date_from: string
      /**
       * Date To
       * Format: date
       */
      date_to: string
      /**
       * Key
       * @enum {string}
       */
      key: 'today' | 'week' | 'month'
      /** Processed Count */
      processed_count: number
    }
    /** TeamYieldResponse */
    TeamYieldResponse: {
      /** Current Weight */
      current_weight: number
      /** Input Weight */
      input_weight: number
      /** Lost Weight */
      lost_weight: number
      /** Max Weight Difference */
      max_weight_difference: number
      /** Output Weight */
      output_weight: number
      /** Processing Delta Weight */
      processing_delta_weight: number
      /** Rate */
      rate: number | null
      /** Reallocated Out Weight */
      reallocated_out_weight: number
      /**
       * Status
       * @enum {string}
       */
      status: 'complete' | 'in_progress' | 'needs_review'
      /** Team Id */
      team_id: number
      /** Team Name */
      team_name: string
      /** Weight Difference */
      weight_difference: number
    }
    /** TeamYieldsResponse */
    TeamYieldsResponse: {
      /** Items */
      items: components['schemas']['TeamYieldResponse'][]
    }
    /** TraceBatchResponse */
    TraceBatchResponse: {
      /** Allowed Actions */
      allowed_actions: string[]
      /** Barcode Payload */
      barcode_payload: string
      /** Barcode Type */
      barcode_type: string
      /** Batch No */
      batch_no: string
      /**
       * Can Edit Delivery
       * @default false
       */
      can_edit_delivery: boolean
      /** Category Level3 */
      category_level3?: string | null
      /** Context Only */
      context_only: boolean
      /**
       * Created At
       * Format: date-time
       */
      created_at: string
      /** Created By */
      created_by: string
      /** Created By User Id */
      created_by_user_id: number | null
      /** Customer Code */
      customer_code?: string | null
      /** Delivery Date */
      delivery_date?: string | null
      /** Delivery Origin Batch No */
      delivery_origin_batch_no?: string | null
      /** Delivery Quantity */
      delivery_quantity?: number | null
      /** Dispatch No */
      dispatch_no?: string | null
      /** Dispatched At */
      dispatched_at?: string | null
      /** Dispatched By */
      dispatched_by?: string | null
      /** Dispatched By User Id */
      dispatched_by_user_id?: number | null
      /**
       * Entry Kind
       * @default transfer
       */
      entry_kind: string
      /** External Destination */
      external_destination?: string | null
      /** External Source */
      external_source?: string | null
      /** Finished Quantity */
      finished_quantity?: number | null
      /** Finished Specification */
      finished_specification?: string | null
      /** History */
      history?: components['schemas']['MaterialTransferEventResponse'][]
      /** Id */
      id: number
      /** Inspection Checked At */
      inspection_checked_at: string | null
      /** Inspection Failed Quantity */
      inspection_failed_quantity: number | null
      /** Inspection Hold Id */
      inspection_hold_id: number | null
      /** Inspection Inspector */
      inspection_inspector: string | null
      /** Inspection Sample Quantity */
      inspection_sample_quantity: number | null
      /** Inspection Scope */
      inspection_scope: ('sample' | 'full') | null
      /** Inspection Source Batch No */
      inspection_source_batch_no: string | null
      /** Inspection Status */
      inspection_status: ('held' | 'failed' | 'passed') | null
      /** Locked */
      locked: boolean
      /** Locked At */
      locked_at: string | null
      /** Loss Records */
      loss_records?: {
        [key: string]: unknown
      }[]
      /** Material Description */
      material_description?: string | null
      /** Material Name */
      material_name?: string | null
      /** Material Shape */
      material_shape?: string | null
      /** Material Type */
      material_type?: string | null
      next_team: components['schemas']['MaterialTransferTeamSnapshot'] | null
      /** Next Team Id */
      next_team_id: number | null
      /** Notes */
      notes: string | null
      /** On Hand Quantity */
      on_hand_quantity: number | null
      /** On Hand Weight */
      on_hand_weight: number | null
      /** Order Category */
      order_category?: string | null
      /** Other Processing Outputs */
      other_processing_outputs: components['schemas']['TraceSiblingOutputResponse'][]
      /** Outsourced Unit */
      outsourced_unit?: string | null
      /** Owned Quantity */
      owned_quantity: number | null
      /** Owned Weight */
      owned_weight: number | null
      /** Part No */
      part_no?: string | null
      /** Process Route */
      process_route?: {
        [key: string]: unknown
      } | null
      /** Processing Delta Weight */
      processing_delta_weight: number
      /** Processing Role */
      processing_role?: ('remaining' | 'produced' | 'scrap') | null
      /** Product Code */
      product_code?: string | null
      /** Purpose Category */
      purpose_category?: string | null
      /** Purpose Id */
      purpose_id?: number | null
      /** Purpose Name */
      purpose_name?: string | null
      /** Quantity */
      quantity: number
      /** Quantity Unit */
      quantity_unit: string
      /** Receipt Kind */
      receipt_kind?: string | null
      /** Received At */
      received_at: string | null
      /** Received By */
      received_by: string | null
      /** Received By User Id */
      received_by_user_id: number | null
      /** Received Employee Id */
      received_employee_id?: number | null
      /** Received Employee Name */
      received_employee_name?: string | null
      /** Rejection Reason */
      rejection_reason?: string | null
      /** Return Dispatch No */
      return_dispatch_no?: string | null
      /**
       * Rework Count
       * @default 0
       */
      rework_count: number
      /**
       * Rework Pending
       * @default false
       */
      rework_pending: boolean
      /** Rework Route Id */
      rework_route_id?: number | null
      /**
       * Rework Route Ready
       * @default false
       */
      rework_route_ready: boolean
      /** Sent Employee Id */
      sent_employee_id?: number | null
      /** Sent Employee Name */
      sent_employee_name?: string | null
      /** Sent Process Step Index */
      sent_process_step_index: number | null
      /** Sent Processing Status */
      sent_processing_status?: string | null
      /** Serial No */
      serial_no: string
      /** Shared Group Id */
      shared_group_id?: number | null
      /** Shared Origin Batch No */
      shared_origin_batch_no?: string | null
      /** Shared Serials */
      shared_serials?: components['schemas']['SharedMaterialSerial-Output'][]
      /**
       * Shared Unallocated
       * @default false
       */
      shared_unallocated: boolean
      /** Sludge Content Percent */
      sludge_content_percent?: number | null
      /** Sludge Gross Weight */
      sludge_gross_weight?: number | null
      /**
       * Sludge Percent Locked
       * @default false
       */
      sludge_percent_locked: boolean
      /** Source Batch No */
      source_batch_no?: string | null
      /** Source Serial No */
      source_serial_no?: string | null
      source_team: components['schemas']['MaterialTransferTeamSnapshot'] | null
      /** Source Team Id */
      source_team_id: number | null
      /** Source Transfer Batch No */
      source_transfer_batch_no?: string | null
      /** Source Transfer Id */
      source_transfer_id?: number | null
      /** Special Process */
      special_process?: string | null
      /** Status */
      status: string
      /**
       * Stock Tracked
       * @default false
       */
      stock_tracked: boolean
      /** Technical Requirements */
      technical_requirements?: string | null
      /** Transfer Specification */
      transfer_specification?: string | null
      /**
       * Updated At
       * Format: date-time
       */
      updated_at: string
      /** Urgency */
      urgency?: {
        [key: string]: unknown
      } | null
      /** Version */
      version: number
      /** Voided At */
      voided_at: string | null
      /** Voided By */
      voided_by: string | null
      /** Voided By User Id */
      voided_by_user_id: number | null
      /** Warehouse Location */
      warehouse_location?: string | null
      /** Weight */
      weight: number
      /** Weight Difference */
      weight_difference?: number | null
      /** Weight Root Transfer Id */
      weight_root_transfer_id?: number | null
      /** Weight Unit */
      weight_unit: string
    }
    /** TraceHoldingResponse */
    TraceHoldingResponse: {
      /** Material Types */
      material_types: components['schemas']['TraceMaterialHoldingResponse'][]
      /** Team Code */
      team_code: string
      /** Team Id */
      team_id: number
      /** Team Name */
      team_name: string
    }
    /** TraceMaterialHoldingResponse */
    TraceMaterialHoldingResponse: {
      /** Material Type */
      material_type: string | null
      /** Quantity */
      quantity: number
      /** Weight */
      weight: number
    }
    /** TracePositionResponse */
    TracePositionResponse: {
      /** Batch Count */
      batch_count: number
      /** Quantity */
      quantity: number
      /** Team Id */
      team_id: number
      /** Team Name */
      team_name: string
      /** Weight */
      weight: number
    }
    /** TraceRouteResponse */
    TraceRouteResponse: {
      /** Id */
      id: number
      /**
       * Route Kind
       * @enum {string}
       */
      route_kind: 'normal' | 'rework'
      /** Steps */
      steps: components['schemas']['RouteStepResponse'][]
    }
    /** TraceSharedPositionResponse */
    TraceSharedPositionResponse: {
      /** Material Type */
      material_type: string | null
      /** Origin Batch No */
      origin_batch_no: string
      /** Quantity */
      quantity: number
      /** Serials */
      serials: string[]
      /** Team Id */
      team_id: number
      /** Team Name */
      team_name: string
      /** Weight */
      weight: number
    }
    /** TraceSiblingOutputResponse */
    TraceSiblingOutputResponse: {
      /**
       * At
       * Format: date-time
       */
      at: string
      /** Batch No */
      batch_no: string
      /** Quantity */
      quantity: number
      /** Serial No */
      serial_no: string | null
      /** Weight */
      weight: number
    }
    /** TraceTotalsResponse */
    TraceTotalsResponse: {
      dispatched: components['schemas']['AmountResponse']
      external_pending: components['schemas']['AmountResponse']
      in_transit: components['schemas']['AmountResponse']
      lost: components['schemas']['AmountResponse']
      on_hand: components['schemas']['AmountResponse']
    }
    /** TransferAmendmentListResponse */
    TransferAmendmentListResponse: {
      /** Editable */
      editable: boolean
      /** Items */
      items: components['schemas']['TransferAmendmentResponse'][]
      /** Remaining Quantity */
      remaining_quantity: number
      /** Remaining Weight */
      remaining_weight: number
    }
    /** TransferAmendmentResponse */
    TransferAmendmentResponse: {
      after: components['schemas']['AmendmentValuesResponse']
      /** Allowed Actions */
      allowed_actions: ('approve' | 'reject' | 'cancel')[]
      /** Batch No */
      batch_no: string
      before: components['schemas']['AmendmentValuesResponse']
      /** Counterparty Team Id */
      counterparty_team_id: number
      /** Counterparty Team Name */
      counterparty_team_name: string
      /**
       * Created At
       * Format: date-time
       */
      created_at: string
      /** Id */
      id: number
      /** Reason */
      reason: string
      /** Requested By */
      requested_by: string
      /** Requester Team Id */
      requester_team_id: number
      /** Requester Team Name */
      requester_team_name: string
      /** Resolved At */
      resolved_at: string | null
      /** Resolved By */
      resolved_by: string | null
      /** Response Reason */
      response_reason: string | null
      /** Serial No */
      serial_no: string
      /**
       * Status
       * @enum {string}
       */
      status: 'pending' | 'approved' | 'rejected' | 'cancelled'
    }
    /** UrgencyResponse */
    UrgencyResponse: {
      /** Reason */
      reason: string | null
      /** Updated At */
      updated_at: string | null
      /** Updated By */
      updated_by: string | null
      /** Urgent */
      urgent: boolean
      /** Version */
      version: number
    }
    /** UrgencyUpdate */
    UrgencyUpdate: {
      /** Expected Version */
      expected_version: number
      /** Reason */
      reason?: string | null
      /** Serial No */
      serial_no: string
      /** Urgent */
      urgent: boolean
    }
    /** UserCreate */
    UserCreate: {
      /**
       * Active
       * @default true
       */
      active: boolean
      /**
       * Avatar Key
       * @default
       * @enum {string}
       */
      avatar_key:
        | ''
        | 'portrait-1'
        | 'portrait-2'
        | 'portrait-3'
        | 'portrait-4'
        | 'portrait-5'
        | 'portrait-6'
        | 'portrait-7'
        | 'portrait-8'
        | 'portrait-9'
        | 'portrait-10'
        | 'portrait-11'
        | 'portrait-12'
        | 'portrait-13'
        | 'portrait-14'
        | 'portrait-15'
        | 'portrait-16'
      /** Display Name */
      display_name: string
      /** Password */
      password: string
      /** Role */
      role: string
      /** Team Id */
      team_id?: number | null
      /** Username */
      username: string
    }
    /** UserResponse */
    UserResponse: {
      /** Active */
      active: boolean
      /**
       * Avatar Key
       * @default
       */
      avatar_key: string
      /**
       * Created At
       * Format: date-time
       */
      created_at: string
      /** Display Name */
      display_name: string
      /** Id */
      id: number
      /** Role */
      role: string
      /** Team Code */
      team_code: string | null
      /** Team Id */
      team_id: number | null
      /** Team Kind */
      team_kind?: string | null
      /** Team Name */
      team_name: string | null
      /**
       * Updated At
       * Format: date-time
       */
      updated_at: string
      /** Username */
      username: string
    }
    /** UserUpdate */
    UserUpdate: {
      /** Active */
      active?: boolean | null
      /** Avatar Key */
      avatar_key?:
        | (
            | ''
            | 'portrait-1'
            | 'portrait-2'
            | 'portrait-3'
            | 'portrait-4'
            | 'portrait-5'
            | 'portrait-6'
            | 'portrait-7'
            | 'portrait-8'
            | 'portrait-9'
            | 'portrait-10'
            | 'portrait-11'
            | 'portrait-12'
            | 'portrait-13'
            | 'portrait-14'
            | 'portrait-15'
            | 'portrait-16'
          )
        | null
      /** Display Name */
      display_name?: string | null
      /** Password */
      password?: string | null
      /** Role */
      role?: string | null
      /** Team Id */
      team_id?: number | null
    }
    /** ValidationError */
    ValidationError: {
      /** Location */
      loc: (string | number)[]
      /** Message */
      msg: string
      /** Error Type */
      type: string
    }
    /** WarehouseLeaseResponse */
    WarehouseLeaseResponse: {
      /** Expires At */
      expires_at: string
      /** Hold Until */
      hold_until: string
      /** Id */
      id: number
      /** Key */
      key: string
      /** Name */
      name: string
    }
    /** WarehouseLocationPage */
    WarehouseLocationPage: {
      /** Items */
      items: components['schemas']['WarehouseLocationResponse'][]
      /** Page */
      page: number
      /** Page Size */
      page_size: number
      /** Team Id */
      team_id: number
      /** Total */
      total: number
    }
    /** WarehouseLocationResponse */
    WarehouseLocationResponse: {
      /** Active */
      active: boolean
      /** Batches */
      batches: components['schemas']['WarehouseOccupantResponse'][]
      /** Draft Locked */
      draft_locked: boolean
      /** Has Stock */
      has_stock: boolean
      /** Id */
      id: number
      /** Name */
      name: string
      /**
       * Status
       * @enum {string}
       */
      status: 'occupied' | 'locked' | 'available' | 'disabled'
      /** Team Id */
      team_id: number
      /** Version */
      version: number
    }
    /** WarehouseOccupantResponse */
    WarehouseOccupantResponse: {
      /** Available Quantity */
      available_quantity: number
      /** Available Weight */
      available_weight: number
      /** Batch No */
      batch_no: string
      /** Created At */
      created_at: string
      /** Id */
      id: number
      /** Location Id */
      location_id: number
      /** Material Name */
      material_name: string | null
      /** Material Type */
      material_type: string | null
      /** Quantity */
      quantity: number
      /** Received At */
      received_at: string | null
      /** Serial No */
      serial_no: string
      /** Shared Group Id */
      shared_group_id: number | null
      /** Shared Origin Batch No */
      shared_origin_batch_no?: string | null
      /** Shared Serials */
      shared_serials?: components['schemas']['SharedSerialResponse'][] | null
      /** Shared Unallocated */
      shared_unallocated: boolean
      /** Status */
      status: string
      /** Weight */
      weight: number
    }
    /**
     * WarehouseReceiptCreate
     * @description Explicit stock origin; never impersonate an upstream team or ERP event.
     */
    WarehouseReceiptCreate: {
      /** Category Level3 */
      category_level3?: string | null
      /**
       * Confirmed Imports
       * @default false
       */
      confirmed_imports: boolean
      /** Customer Code */
      customer_code?: string | null
      /** Delivery Date */
      delivery_date?: string | null
      /** Delivery Quantity */
      delivery_quantity?: number | null
      /** Document Ids */
      document_ids?: number[]
      /** External Source */
      external_source?: string | null
      /** Finished Quantity */
      finished_quantity?: number | null
      /** Finished Specification */
      finished_specification?: string | null
      /** Idempotency Key */
      idempotency_key: string
      /** Material Description */
      material_description?: string | null
      /** Material Name */
      material_name: string
      /** Material Shape */
      material_shape?: string | null
      /** Material Type */
      material_type: string
      /**
       * Notes
       * @default
       */
      notes: string
      /** Order Category */
      order_category?: string | null
      /** Outsourced Unit */
      outsourced_unit?: string | null
      /** Part No */
      part_no?: string | null
      process_route?: components['schemas']['RouteIntakeWrite'] | null
      /** Product Code */
      product_code?: string | null
      /** Purpose Category */
      purpose_category?: string | null
      /** Quantity */
      quantity: number
      /**
       * Receipt Kind
       * @default external
       * @enum {string}
       */
      receipt_kind: 'external' | 'return'
      /** Return Dispatch No */
      return_dispatch_no?: string | null
      /**
       * Serial No
       * @default
       */
      serial_no: string
      /** Shared Serials */
      shared_serials?: components['schemas']['SharedMaterialSerial-Input'][] | null
      /** Sludge Content Percent */
      sludge_content_percent?: number | string | null
      /** Sludge Gross Weight */
      sludge_gross_weight?: number | string | null
      /** Source Batch No */
      source_batch_no?: string | null
      /** Special Process */
      special_process?: string | null
      /** Technical Requirements */
      technical_requirements?: string | null
      /** Transfer Specification */
      transfer_specification?: string | null
      /** Warehouse Location */
      warehouse_location?: string | null
      /** Warehouse Location Reservation Key */
      warehouse_location_reservation_key?: string | null
      /** Weight */
      weight: number | string
    }
  }
  responses: never
  parameters: never
  requestBodies: never
  headers: never
  pathItems: never
}
export type $defs = Record<string, never>
export interface operations {
  lock_api_access_lock_post: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['AccessStatusResponse']
        }
      }
    }
  }
  access_status_api_access_status_get: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['AccessStatusResponse']
        }
      }
    }
  }
  unlock_api_access_unlock_post: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['AccessStatusResponse']
        }
      }
    }
  }
  list_users_api_accounts_get: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['UserResponse'][]
        }
      }
    }
  }
  create_user_api_accounts_post: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['UserCreate']
      }
    }
    responses: {
      /** @description Successful Response */
      201: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['UserResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  get_user_api_accounts__user_id__get: {
    parameters: {
      query?: never
      header?: never
      path: {
        user_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['UserResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  delete_user_api_accounts__user_id__delete: {
    parameters: {
      query?: never
      header?: never
      path: {
        user_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      204: {
        headers: {
          [name: string]: unknown
        }
        content?: never
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  update_user_api_accounts__user_id__patch: {
    parameters: {
      query?: never
      header?: never
      path: {
        user_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['UserUpdate']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['UserResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  change_password_api_auth_change_password_post: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['PasswordChangeRequest']
      }
    }
    responses: {
      /** @description Successful Response */
      204: {
        headers: {
          [name: string]: unknown
        }
        content?: never
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  login_api_auth_login_post: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['LoginRequest']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['LoginResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  logout_api_auth_logout_post: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      204: {
        headers: {
          [name: string]: unknown
        }
        content?: never
      }
    }
  }
  auth_me_api_auth_me_get: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['UserResponse']
        }
      }
    }
  }
  update_profile_api_auth_me_patch: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['ProfileUpdate']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['UserResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  inbox_api_business_notices_get: {
    parameters: {
      query?: {
        category?: 'all' | 'schedule' | 'rework' | 'transfer' | 'quality' | 'pending'
        page?: number
        unread_only?: boolean
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['BusinessNoticePageResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  mark_read_api_business_notices__source___notice_id__read_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        notice_id: number
        source: 'schedule' | 'rework' | 'transfer' | 'quality'
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      204: {
        headers: {
          [name: string]: unknown
        }
        content?: never
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  target_api_business_notices__source___notice_id__target_get: {
    parameters: {
      query?: never
      header?: never
      path: {
        notice_id: number
        source: 'schedule' | 'rework' | 'transfer' | 'quality'
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['NoticeTargetResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  read_all_api_business_notices_read_all_post: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['BusinessNoticeReadAll']
      }
    }
    responses: {
      /** @description Successful Response */
      204: {
        headers: {
          [name: string]: unknown
        }
        content?: never
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  get_dashboard_api_factory_dashboard_get: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['FactoryDashboardResponse']
        }
      }
    }
  }
  get_deliveries_api_factory_dashboard_deliveries_get: {
    parameters: {
      query?: {
        page?: number
        page_size?: number
        query?: string
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['PageResponse_DeliveryResponse_']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  get_plan_api_factory_dashboard_delivery_plan_get: {
    parameters: {
      query: {
        serial_no: string
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['LegacyDeliveryPlanResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  save_plan_api_factory_dashboard_delivery_plan_put: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': unknown
        }
      }
    }
  }
  get_serials_api_factory_dashboard_serials_get: {
    parameters: {
      query?: {
        page?: number
        page_size?: number
        query?: string
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['PageResponse_DashboardSerialResponse_']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  get_shipments_api_factory_dashboard_shipments_get: {
    parameters: {
      query: {
        date_from: string
        date_to: string
        serial_no?: string[]
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ShipmentsResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  get_stock_detail_api_factory_dashboard_stock_detail_get: {
    parameters: {
      query?: {
        material?: string
        page?: number
        page_size?: number
        team_id?: number | null
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['PageResponse_DashboardStockDetailResponse_']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  get_team_yields_api_factory_dashboard_team_yields_get: {
    parameters: {
      query: {
        material?: string
        serial_no: string
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TeamYieldsResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  get_yields_api_factory_dashboard_yields_get: {
    parameters: {
      query?: {
        material?: string
        page?: number
        page_size?: number
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['PageResponse_SerialYieldResponse_']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  overview_endpoint_api_factory_overview_get: {
    parameters: {
      query?: {
        days?: number
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['FactoryOverviewResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  changes_endpoint_api_factory_overview_changes_get: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content?: never
      }
    }
  }
  inventory_endpoint_api_factory_overview_stream_get: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content?: never
      }
    }
  }
  report_api_factory_performance_get: {
    parameters: {
      query?: {
        date_from?: string | null
        date_to?: string | null
        include_activity?: boolean
        material_name?: string | null
        period?: 'day' | 'week' | 'month'
        serial_no?: string | null
        team_id?: number | null
        work_id?: number | null
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['FactoryPerformanceResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  health_api_health_get: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HealthResponse']
        }
      }
    }
  }
  records_api_inspections_get: {
    parameters: {
      query?: {
        date_from?: string | null
        date_to?: string | null
        inspector_id?: number | null
        kind?: ('patrol' | 'inspection') | null
        page?: number
        page_size?: number
        problem_type_id?: number | null
        query?: string | null
        scope?: ('sample' | 'full') | null
        source_transfer_id?: number | null
        status?: ('pending' | 'released' | 'passed' | 'failed') | null
        team_id?: number | null
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['PageResponse_InspectionRecordResponse_']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  create_api_inspections_post: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['InspectionCreate']
      }
    }
    responses: {
      /** @description Successful Response */
      201: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['InspectionRecordResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  recheck_context_api_inspections__inspection_id__recheck_context_get: {
    parameters: {
      query?: never
      header?: never
      path: {
        inspection_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['InspectionSourceResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  sources_api_inspections_sources_get: {
    parameters: {
      query: {
        group_id?: number | null
        kind?: 'patrol' | 'inspection'
        page?: number
        page_size?: number
        query?: string | null
        recheck_id?: number | null
        team_id: number
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['PageResponse_InspectionSourceResponse_']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  get_configuration_api_main_system_configuration_get: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['MainSystemConfigurationResponse']
        }
      }
    }
  }
  save_configuration_api_main_system_configuration_put: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['ConfigurationSave']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['MainSystemConfigurationResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  test_configuration_api_main_system_configuration_test_post: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['ConfigurationTest']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ConfigurationTestResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  lookup_serial_api_main_system_serial_material_get: {
    parameters: {
      query: {
        serial_no: string
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['MainSystemLookup']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  receive_from_main_system_api_main_system_warehouses__team_id__receipts_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['MainSystemReceiptCreate']
      }
    }
    responses: {
      /** @description Successful Response */
      201: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['MaterialTransferResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  get_dispatch_api_material_dispatches__dispatch_no__get: {
    parameters: {
      query?: never
      header?: never
      path: {
        dispatch_no: string
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['MaterialDispatchResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  confirm_dispatch_api_material_dispatches__dispatch_no__confirm_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        dispatch_no: string
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['DispatchReceiptConfirm']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['MaterialDispatchResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  confirm_outbound_api_material_dispatches__dispatch_no__confirm_outbound_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        dispatch_no: string
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['DispatchConfirm']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['MaterialDispatchResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  material_input_suggestions_api_material_input_suggestions_get: {
    parameters: {
      query: {
        field: string
        limit?: number
        query?: string
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['MaterialSuggestionsResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  get_serial_trace_api_material_trace_get: {
    parameters: {
      query: {
        serial_no: string
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['MaterialTraceResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  list_material_transfers_api_material_transfers_get: {
    parameters: {
      query?: {
        batch_query?: string
        date_from?: string | null
        date_to?: string | null
        direction?: string
        include_summary?: boolean
        material_query?: string
        material_type?: string | null
        material_types?: string
        next_team_id?: number | null
        next_team_ids?: string
        page?: number
        page_size?: number
        purpose_query?: string
        quantity_max?: number | null
        quantity_min?: number | null
        query?: string | null
        search_field?: string
        search_mode?: string
        serial_no?: string | null
        serial_query?: string
        source_team_id?: number | null
        source_team_ids?: string
        status?: string | null
        statuses?: string
        target_team_id?: number | null
        team_id?: number | null
        urgent_only?: boolean
        weight_max?: number | string | null
        weight_min?: number | string | null
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['MaterialTransferList']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  create_material_transfer_api_material_transfers_post: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['MaterialTransferCreate']
      }
    }
    responses: {
      /** @description Successful Response */
      201: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['MaterialTransferResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  get_material_transfer_api_material_transfers__batch_no__get: {
    parameters: {
      query?: never
      header?: never
      path: {
        batch_no: string
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['MaterialTransferResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  void_material_transfer_api_material_transfers__batch_no__delete: {
    parameters: {
      query?: never
      header?: never
      path: {
        batch_no: string
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      204: {
        headers: {
          [name: string]: unknown
        }
        content?: never
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  update_material_transfer_api_material_transfers__batch_no__patch: {
    parameters: {
      query?: never
      header?: never
      path: {
        batch_no: string
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['MaterialTransferUpdate']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['MaterialTransferResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  list_amendments_api_material_transfers__batch_no__amendments_get: {
    parameters: {
      query?: never
      header?: never
      path: {
        batch_no: string
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TransferAmendmentListResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  post_amendment_api_material_transfers__batch_no__amendments_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        batch_no: string
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['AmendmentCreate']
      }
    }
    responses: {
      /** @description Successful Response */
      201: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TransferAmendmentResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  confirm_material_transfer_api_material_transfers__batch_no__confirm_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        batch_no: string
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['MaterialReceiptConfirm']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['MaterialTransferResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  confirm_outbound_api_material_transfers__batch_no__confirm_outbound_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        batch_no: string
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['MaterialTransferConfirm']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['MaterialTransferResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  update_delivery_api_material_transfers__batch_no__delivery_patch: {
    parameters: {
      query?: never
      header?: never
      path: {
        batch_no: string
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['MaterialDeliveryUpdate']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['MaterialTransferResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  receipt_documents_api_material_transfers__batch_no__receipt_documents_get: {
    parameters: {
      query?: never
      header?: never
      path: {
        batch_no: string
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ReceiptDocumentsResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  reject_material_transfer_api_material_transfers__batch_no__reject_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        batch_no: string
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['MaterialTransferReject']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['MaterialTransferResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  notification_status_api_notifications_status_get: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['NotificationStatusResponse']
        }
      }
    }
  }
  list_routes_api_process_routes_get: {
    parameters: {
      query?: {
        kind?: 'normal' | 'rework' | 'all'
        page?: number
        page_size?: number
        query?: string
        rework_scope?: 'open' | 'ended' | 'all'
        sort_order?: 'asc' | 'desc'
        state?: ('draft' | 'published') | null
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ProcessRoutePageResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  create_draft_api_process_routes_post: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'multipart/form-data': components['schemas']['Body_create_draft_api_process_routes_post']
      }
    }
    responses: {
      /** @description Successful Response */
      201: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ProcessRouteDetailResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  detail_api_process_routes__route_id__get: {
    parameters: {
      query?: never
      header?: never
      path: {
        route_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ProcessRouteDetailResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  save_draft_api_process_routes__route_id__put: {
    parameters: {
      query?: never
      header?: never
      path: {
        route_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['RouteDraftWrite']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ProcessRouteDetailResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  bind_api_process_routes__route_id__bind_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        route_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['BindWrite']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['BoundRouteResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  dispatch_order_api_process_routes__route_id__dispatch_order_get: {
    parameters: {
      query: {
        serial_no: string
      }
      header?: never
      path: {
        route_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['RouteDispatchOrderResponse'] | null
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  upload_drawing_api_process_routes__route_id__drawings_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        route_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'multipart/form-data': components['schemas']['Body_upload_drawing_api_process_routes__route_id__drawings_post']
      }
    }
    responses: {
      /** @description Successful Response */
      201: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ProcessRouteDetailResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  download_drawing_api_process_routes__route_id__drawings__drawing_id__get: {
    parameters: {
      query?: {
        preview?: boolean
      }
      header?: never
      path: {
        drawing_id: number
        route_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content?: never
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  remove_drawing_api_process_routes__route_id__drawings__drawing_id__delete: {
    parameters: {
      query: {
        version: number
      }
      header?: never
      path: {
        drawing_id: number
        route_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ProcessRouteDetailResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  download_order_api_process_routes__route_id__order_get: {
    parameters: {
      query?: {
        preview?: boolean
      }
      header?: never
      path: {
        route_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content?: never
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  attach_order_api_process_routes__route_id__order_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        route_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'multipart/form-data': components['schemas']['Body_attach_order_api_process_routes__route_id__order_post']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ProcessRouteDetailResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  publish_api_process_routes__route_id__publish_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        route_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['RevisionWrite']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ProcessRouteDetailResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  revise_api_process_routes__route_id__revise_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        route_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      201: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ProcessRouteDetailResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  rework_rounds_api_process_routes__route_id__rework_rounds_get: {
    parameters: {
      query?: never
      header?: never
      path: {
        route_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ReworkRoundResponse'][]
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  source_api_process_routes__route_id__source_get: {
    parameters: {
      query?: never
      header?: never
      path: {
        route_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content?: never
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  attach_word_api_process_routes__route_id__source_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        route_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'multipart/form-data': components['schemas']['Body_attach_word_api_process_routes__route_id__source_post']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ProcessRouteDetailResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  preview_uploaded_drawing_api_process_routes_drawing_preview_post: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'multipart/form-data': components['schemas']['Body_preview_uploaded_drawing_api_process_routes_drawing_preview_post']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content?: never
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  import_word_api_process_routes_import_post: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'multipart/form-data': components['schemas']['Body_import_word_api_process_routes_import_post']
      }
    }
    responses: {
      /** @description Successful Response */
      201: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ProcessRouteDetailResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  lot_route_api_process_routes_lots__lot_id__get: {
    parameters: {
      query?: never
      header?: never
      path: {
        lot_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['LotRouteResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  execution_options_api_process_routes_options__team_id__get: {
    parameters: {
      query?: never
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['RouteExecutionOptionsResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  parse_word_api_process_routes_parse_post: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'multipart/form-data': components['schemas']['Body_parse_word_api_process_routes_parse_post']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ProcessRouteParseResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  parse_order_file_api_process_routes_parse_order_post: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'multipart/form-data': components['schemas']['Body_parse_order_file_api_process_routes_parse_order_post']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['RouteOrderDocumentResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  resolve_route_api_process_routes_resolve_get: {
    parameters: {
      query: {
        serial_no: string
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ProcessRouteDetailResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  resume_rework_route_api_process_routes_rework_lots__lot_id__resume_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        lot_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['ResumeWrite']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ReworkResumeResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  request_rework_route_api_process_routes_rework_requests_post: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['ReworkRequest']
      }
    }
    responses: {
      /** @description Successful Response */
      201: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ProcessRouteDetailResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  rework_sources_api_process_routes_rework_sources_get: {
    parameters: {
      query?: {
        lot_id?: number | null
        page?: number
        query?: string
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json':
            | components['schemas']['PageResponse_ReworkSourceResponse_']
            | components['schemas']['QuantityAdjustmentContextResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  list_schedules_api_production_schedules_get: {
    parameters: {
      query?: {
        due_from?: string | null
        due_to?: string | null
        page?: number
        page_size?: number
        query?: string | null
        serial_no?: string | null
        status?:
          | (
              | 'pending'
              | 'today'
              | 'overdue'
              | 'completed'
              | 'completed_late'
              | 'cancelled'
              | 'not_assessed'
            )
          | null
        task_id?: number | null
        team_id?: number | null
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['PageResponse_ScheduleResponse_']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  create_schedule_api_production_schedules_post: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['ScheduleCreate']
      }
    }
    responses: {
      /** @description Successful Response */
      201: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': unknown
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  detail_api_production_schedules__schedule_id__get: {
    parameters: {
      query?: never
      header?: never
      path: {
        schedule_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ScheduleDetailResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  update_api_production_schedules__schedule_id__patch: {
    parameters: {
      query?: never
      header?: never
      path: {
        schedule_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['ScheduleUpdate']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ScheduleDetailResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  update_batches_api_production_schedules__schedule_id__batches_put: {
    parameters: {
      query?: never
      header?: never
      path: {
        schedule_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['BatchPlanWrite']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ScheduleDetailResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  cancel_api_production_schedules__schedule_id__cancel_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        schedule_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['ScheduleCancel']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ScheduleDetailResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  update_commitment_api_production_schedules__schedule_id__commitment_patch: {
    parameters: {
      query?: never
      header?: never
      path: {
        schedule_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['ScheduleCommitmentUpdate']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ScheduleDetailResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  review_plan_api_production_schedules__schedule_id__review_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        schedule_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['PlanReview']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ScheduleDetailResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  list_business_people_api_production_schedules_business_people_get: {
    parameters: {
      query?: {
        page?: number
        page_size?: number
        query?: string | null
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['PageResponse_BusinessPersonResponse_']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  create_business_person_api_production_schedules_business_people_post: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['BusinessPersonWrite']
      }
    }
    responses: {
      /** @description Successful Response */
      201: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['BusinessPersonResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  update_business_person_api_production_schedules_business_people__person_id__patch: {
    parameters: {
      query?: never
      header?: never
      path: {
        person_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['BusinessPersonWrite']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['BusinessPersonResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  candidates_api_production_schedules_candidates_get: {
    parameters: {
      query: {
        external_destination?: string | null
        next_team_id?: number | null
        source_transfer_ids: string
        team_id: number
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ScheduleCandidatesResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  inventory_api_production_schedules_inventory_post: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['ScheduleInventoryQuery']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['InventorySchedulesResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  preview_order_original_api_production_schedules_order_preview_post: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'multipart/form-data': components['schemas']['Body_preview_order_original_api_production_schedules_order_preview_post']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content?: never
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  get_overview_api_production_schedules_overview_get: {
    parameters: {
      query?: {
        days?: number
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ScheduleOverviewResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  preview_order_api_production_schedules_parse_order_post: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'multipart/form-data': components['schemas']['Body_preview_order_api_production_schedules_parse_order_post']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['RouteOrderDocumentResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  new_task_route_options_api_production_schedules_route_options_get: {
    parameters: {
      query?: {
        serial_no?: string
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ScheduleRouteOptionResponse'][]
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  serial_options_api_production_schedules_serial_options_get: {
    parameters: {
      query?: {
        page?: number
        page_size?: number
        query?: string | null
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['PageResponse_ScheduleSerialOptionResponse_']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  source_options_api_production_schedules_source_options_get: {
    parameters: {
      query: {
        page?: number
        page_size?: number
        query?: string | null
        schedule_id?: number | null
        serial_no: string
        team_id: number
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['PageResponse_ScheduleSourceOptionResponse_']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  list_tasks_api_production_schedules_tasks_get: {
    parameters: {
      query?: {
        business_person_ids?: number[] | null
        due_from?: string | null
        due_to?: string | null
        page?: number
        page_size?: number
        query?: string | null
        scope?: ('attention' | 'completed') | null
        serial_no?: string | null
        serial_nos?: string[] | null
        sort_order?: 'asc' | 'desc'
        status?:
          | (
              | 'pending'
              | 'today'
              | 'overdue'
              | 'completed'
              | 'completed_late'
              | 'cancelled'
              | 'not_assessed'
            )
          | null
        team_id?: number | null
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['PageResponse_ScheduleTaskResponse_']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  create_task_api_production_schedules_tasks_post: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'multipart/form-data': components['schemas']['Body_create_task_api_production_schedules_tasks_post']
      }
    }
    responses: {
      /** @description Successful Response */
      201: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ScheduleTaskDetailResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  task_detail_api_production_schedules_tasks__task_id__get: {
    parameters: {
      query?: never
      header?: never
      path: {
        task_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ScheduleTaskDetailResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  delete_task_api_production_schedules_tasks__task_id__delete: {
    parameters: {
      query?: never
      header?: never
      path: {
        task_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['TaskDelete']
      }
    }
    responses: {
      /** @description Successful Response */
      204: {
        headers: {
          [name: string]: unknown
        }
        content?: never
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  update_task_api_production_schedules_tasks__task_id__patch: {
    parameters: {
      query?: never
      header?: never
      path: {
        task_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['ScheduleTaskUpdate']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ScheduleTaskDetailResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  lock_task_api_production_schedules_tasks__task_id__lock_put: {
    parameters: {
      query?: never
      header?: never
      path: {
        task_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['TaskLock']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ScheduleTaskDetailResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  download_order_api_production_schedules_tasks__task_id__order_get: {
    parameters: {
      query?: {
        preview?: boolean
      }
      header?: never
      path: {
        task_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content?: never
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  link_task_rework_api_production_schedules_tasks__task_id__rework_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        task_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['ReworkLink']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ScheduleTaskDetailResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  task_rework_options_api_production_schedules_tasks__task_id__rework_options_get: {
    parameters: {
      query?: never
      header?: never
      path: {
        task_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ScheduleReworkOptionResponse'][]
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  link_task_route_api_production_schedules_tasks__task_id__route_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        task_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['RouteLink']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ScheduleTaskDetailResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  task_route_options_api_production_schedules_tasks__task_id__route_options_get: {
    parameters: {
      query?: never
      header?: never
      path: {
        task_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ScheduleRouteOptionResponse'][]
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  records_api_quality_feedback_get: {
    parameters: {
      query?: {
        date_from?: string | null
        date_to?: string | null
        kind?: ('patrol' | 'inspection') | null
        page?: number
        page_size?: number
        problem_type_id?: number | null
        query?: string | null
        status?: ('pending' | 'processing' | 'closed') | null
        team_id?: number | null
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['QualityFeedbackPageResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  detail_api_quality_feedback__issue_id__get: {
    parameters: {
      query?: never
      header?: never
      path: {
        issue_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['QualityFeedbackDetailResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  decide_api_quality_feedback__issue_id__decision_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        issue_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['Decision']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['QualityFeedbackDetailResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  reply_api_quality_feedback__issue_id__reply_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        issue_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['FeedbackWrite']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['QualityFeedbackDetailResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  rework_stock_api_quality_feedback__issue_id__rework_stock_get: {
    parameters: {
      query?: {
        page?: number
        page_size?: number
        source_transfer_id?: number | null
      }
      header?: never
      path: {
        issue_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json':
            | components['schemas']['PageResponse_QualityReworkStockResponse_']
            | components['schemas']['QuantityAdjustmentContextResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  read_document_api_receipt_documents__document_id__get: {
    parameters: {
      query?: never
      header?: never
      path: {
        document_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ReceiptDocumentResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  delete_upload_api_receipt_documents__document_id__delete: {
    parameters: {
      query?: never
      header?: never
      path: {
        document_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      204: {
        headers: {
          [name: string]: unknown
        }
        content?: never
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  download_document_api_receipt_documents__document_id__file_get: {
    parameters: {
      query?: {
        preview?: boolean
      }
      header?: never
      path: {
        document_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content?: never
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  list_notices_api_rework_notices_get: {
    parameters: {
      query: {
        page?: number
        team_id: number
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ReworkNoticePageResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  mark_read_api_rework_notices__notice_id__read_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        notice_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['NoticeReadResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  notice_route_api_rework_notices__notice_id__route_get: {
    parameters: {
      query?: never
      header?: never
      path: {
        notice_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ProcessRouteDetailResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  inbox_api_schedule_notices_get: {
    parameters: {
      query?: {
        page?: number
        unread_only?: boolean
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ScheduleNoticePageResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  mark_read_api_schedule_notices__notice_id__read_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        notice_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      204: {
        headers: {
          [name: string]: unknown
        }
        content?: never
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  read_all_api_schedule_notices_read_all_post: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['ScheduleNoticeReadAll']
      }
    }
    responses: {
      /** @description Successful Response */
      204: {
        headers: {
          [name: string]: unknown
        }
        content?: never
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  refresh_api_schedule_notices_refresh_post: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      204: {
        headers: {
          [name: string]: unknown
        }
        content?: never
      }
    }
  }
  get_serial_inventory_api_serial_inventory_get: {
    parameters: {
      query: {
        serial_no: string
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['SerialInventoryResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  get_serial_inventory_batches_api_serial_inventory_batches_get: {
    parameters: {
      query: {
        location?: string
        material_name?: string
        material_type?: string
        page?: number
        page_size?: number
        serial_no: string
        shared?: boolean
        team_id: number
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['PageResponse_SerialInventoryBatchResponse_']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  get_all_serial_stock_api_serial_inventory_stock_get: {
    parameters: {
      query?: {
        activity_day?: string | null
        activity_kind?: ('incoming' | 'outgoing' | 'loss') | null
        availability?: 'current' | 'owned' | 'all' | 'available' | 'scrap'
        date_from?: string | null
        date_to?: string | null
        days?: 7 | 30
        flow_direction?: ('incoming' | 'outgoing') | null
        has_loss?: boolean
        location_status?: 'unassigned' | null
        material_name?: string | null
        material_type?: string | null
        page?: number
        page_size?: number
        peer?: string | null
        processing_role?: ('remaining' | 'produced' | 'scrap') | null
        processing_state?:
          | (
              | 'unregistered'
              | 'registered'
              | 'partial'
              | 'complete'
              | 'rework'
              | 'mixed'
              | 'pending'
              | 'cleared'
              | 'not_applicable'
              | 'not_required'
            )
          | null
        /** @description 本班组业务编号；0 表示未指定业务 */
        purpose_id?: number | null
        query?: string | null
        receipt_source?:
          ('external' | 'return' | 'internal' | 'opening' | 'processing' | 'rework') | null
        rework?: ('pending' | 'worked') | null
        route_status?: ('linked' | 'unlinked') | null
        search_field?:
          | 'all'
          | 'serial_no'
          | 'material_name'
          | 'product_code'
          | 'customer_code'
          | 'transfer_specification'
          | 'finished_specification'
          | 'available_quantity'
          | 'available_weight'
          | 'finished_quantity'
          | 'pending_incoming_quantity'
          | 'pending_incoming_weight'
          | 'pending_outgoing_quantity'
          | 'pending_outgoing_weight'
          | 'lost_quantity'
          | 'lost_weight'
          | 'scrap_quantity'
          | 'scrap_weight'
          | 'urgency'
          | 'last_activity_at'
          | 'source'
          | 'purpose_name'
          | 'oldest_received_at'
          | 'on_hand_quantity'
          | 'on_hand_weight'
          | 'owned_quantity'
          | 'owned_weight'
          | 'in_transit_quantity'
          | 'in_transit_weight'
          | 'external_pending_quantity'
          | 'external_pending_weight'
          | 'source_batch_no'
          | 'shortage_weight'
          | 'processing_registered_quantity'
          | 'processing_registered_weight'
          | 'processing_unregistered_quantity'
          | 'processing_unregistered_weight'
        search_operator?: 'eq' | 'gte' | 'lte'
        serial_no?: string | null
        source_team_id?: number | null
        stock_age?: ('lt1' | '1_3' | '3_7' | 'ge7') | null
        stock_age_max?: number | null
        stock_age_min?: number | null
        team_id?: number | null
        urgent_only?: boolean
        waiting_age?: ('lt1' | '1_3' | '3_7' | 'ge7') | null
        waiting_direction?: ('incoming' | 'outgoing') | null
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['FactoryInventoryPageResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  get_urgency_api_serial_urgency_get: {
    parameters: {
      query: {
        serial_no: string
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['UrgencyResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  set_urgency_api_serial_urgency_put: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['UrgencyUpdate']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['UrgencyResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  team_directory_api_team_directory_get: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TeamResponse'][]
        }
      }
    }
  }
  analytics_endpoint_api_team_materials__team_id__analytics_get: {
    parameters: {
      query?: {
        days?: 7 | 30
        metric?: 'quantity' | 'weight'
      }
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['MaterialAnalyticsResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  list_dispatches_api_team_materials__team_id__dispatches_get: {
    parameters: {
      query?: {
        date_from?: string | null
        date_to?: string | null
        entry_kind?: string | null
        next_team_id?: number | null
        page?: number
        page_size?: number
        query?: string | null
        status?: string | null
        urgent_only?: boolean
      }
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['PageResponse_Union_MaterialDispatchResponse__MaterialDispatchSummaryResponse__']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  create_dispatch_api_team_materials__team_id__dispatches_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['DispatchCreate']
      }
    }
    responses: {
      /** @description Successful Response */
      201: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json':
            | components['schemas']['MaterialDispatchResponse']
            | components['schemas']['MaterialBatchesResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  list_employees_api_team_materials__team_id__employees_get: {
    parameters: {
      query?: never
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TeamDirectoryItemResponse'][]
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  create_employee_api_team_materials__team_id__employees_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['DirectoryItemInput']
      }
    }
    responses: {
      /** @description Successful Response */
      201: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TeamDirectoryItemResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  update_employee_api_team_materials__team_id__employees__employee_id__patch: {
    parameters: {
      query?: never
      header?: never
      path: {
        employee_id: number
        team_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['DirectoryItemInput']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TeamDirectoryItemResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  list_inspection_problems_api_team_materials__team_id__inspection_problems_get: {
    parameters: {
      query?: never
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TeamDirectoryItemResponse'][]
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  create_inspection_problem_api_team_materials__team_id__inspection_problems_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['DirectoryItemInput']
      }
    }
    responses: {
      /** @description Successful Response */
      201: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TeamDirectoryItemResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  update_inspection_problem_api_team_materials__team_id__inspection_problems__problem_id__patch: {
    parameters: {
      query?: never
      header?: never
      path: {
        problem_id: number
        team_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['DirectoryItemInput']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TeamDirectoryItemResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  inventory_endpoint_api_team_materials__team_id__inventory_get: {
    parameters: {
      query?: {
        activity_day?: string | null
        activity_kind?: ('incoming' | 'outgoing' | 'loss') | null
        availability?: 'current' | 'owned' | 'all' | 'available' | 'scrap'
        date_from?: string | null
        date_to?: string | null
        days?: 7 | 30
        flow_direction?: ('incoming' | 'outgoing') | null
        has_loss?: boolean
        location_status?: 'unassigned' | null
        material_name?: string | null
        material_type?: string | null
        page?: number
        page_size?: number
        peer?: string | null
        processing_role?: ('remaining' | 'produced' | 'scrap') | null
        processing_state?:
          | (
              | 'unregistered'
              | 'registered'
              | 'partial'
              | 'complete'
              | 'rework'
              | 'mixed'
              | 'pending'
              | 'cleared'
              | 'not_applicable'
              | 'not_required'
            )
          | null
        /** @description 本班组业务编号；0 表示未指定业务 */
        purpose_id?: number | null
        query?: string | null
        receipt_source?:
          ('external' | 'return' | 'internal' | 'opening' | 'processing' | 'rework') | null
        rework?: ('pending' | 'worked') | null
        route_status?: ('linked' | 'unlinked') | null
        search_field?:
          | 'all'
          | 'serial_no'
          | 'material_name'
          | 'product_code'
          | 'customer_code'
          | 'transfer_specification'
          | 'finished_specification'
          | 'available_quantity'
          | 'available_weight'
          | 'finished_quantity'
          | 'pending_incoming_quantity'
          | 'pending_incoming_weight'
          | 'pending_outgoing_quantity'
          | 'pending_outgoing_weight'
          | 'lost_quantity'
          | 'lost_weight'
          | 'scrap_quantity'
          | 'scrap_weight'
          | 'urgency'
          | 'last_activity_at'
          | 'source'
          | 'purpose_name'
          | 'oldest_received_at'
          | 'on_hand_quantity'
          | 'on_hand_weight'
          | 'owned_quantity'
          | 'owned_weight'
          | 'in_transit_quantity'
          | 'in_transit_weight'
          | 'external_pending_quantity'
          | 'external_pending_weight'
          | 'source_batch_no'
          | 'shortage_weight'
          | 'processing_registered_quantity'
          | 'processing_registered_weight'
          | 'processing_unregistered_quantity'
          | 'processing_unregistered_weight'
        search_operator?: 'eq' | 'gte' | 'lte'
        serial_no?: string | null
        source_team_id?: number | null
        stock_age?: ('lt1' | '1_3' | '3_7' | 'ge7') | null
        stock_age_max?: number | null
        stock_age_min?: number | null
        urgent_only?: boolean
        waiting_age?: ('lt1' | '1_3' | '3_7' | 'ge7') | null
        waiting_direction?: ('incoming' | 'outgoing') | null
      }
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TeamInventoryPageResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  movements_endpoint_api_team_materials__team_id__inventory__group_id__movements_get: {
    parameters: {
      query?: {
        page?: number
        page_size?: number
      }
      header?: never
      path: {
        group_id: number
        team_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['StockMovementsResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  pending_endpoint_api_team_materials__team_id__inventory__group_id__pending_outbound_get: {
    parameters: {
      query?: {
        page?: number
        page_size?: number
      }
      header?: never
      path: {
        group_id: number
        team_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['StockMovementsResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  shipment_stock_api_team_materials__team_id__inventory__group_id__shipment_stock_get: {
    parameters: {
      query?: never
      header?: never
      path: {
        group_id: number
        team_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ShipmentStockResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  sources_endpoint_api_team_materials__team_id__inventory__group_id__sources_get: {
    parameters: {
      query?: {
        current_only?: boolean
        date_from?: string | null
        date_to?: string | null
        page?: number
        page_size?: number
        query?: string | null
        urgent_only?: boolean
      }
      header?: never
      path: {
        group_id: number
        team_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['StockPageResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  list_losses_api_team_materials__team_id__losses_get: {
    parameters: {
      query?: {
        date_from?: string | null
        date_to?: string | null
        page?: number
        page_size?: number
        query?: string | null
        serial_no?: string | null
        source_transfer_id?: number | null
        urgent_only?: boolean
      }
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['PageResponse_MaterialLossResponse_']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  create_loss_api_team_materials__team_id__losses_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['LossCreate']
      }
    }
    responses: {
      /** @description Successful Response */
      201: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['MaterialLossResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  state_api_team_materials__team_id__opening_stock_get: {
    parameters: {
      query?: never
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['OpeningStockStateResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  create_api_team_materials__team_id__opening_stock_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['OpeningCreate']
      }
    }
    responses: {
      /** @description Successful Response */
      201: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['OpeningStockResultResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  authorize_opening_api_team_materials__team_id__opening_stock_authorization_put: {
    parameters: {
      query?: never
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['OpeningAuthorization']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['OpeningAuthorizationResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  list_outbound_batches_api_team_materials__team_id__outbound_batches_get: {
    parameters: {
      query?: {
        date_from?: string | null
        date_to?: string | null
        entry_kind?: string | null
        material_type?: string | null
        next_team_id?: number | null
        page?: number
        page_size?: number
        query?: string | null
        status?: string | null
        urgent_only?: boolean
      }
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['MaterialTransferList']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  create_dispatch_api_team_materials__team_id__outbound_batches_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['DispatchCreate']
      }
    }
    responses: {
      /** @description Successful Response */
      201: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json':
            | components['schemas']['MaterialDispatchResponse']
            | components['schemas']['MaterialBatchesResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  overview_api_team_materials__team_id__overview_get: {
    parameters: {
      query?: {
        include_summary?: boolean
      }
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TeamMaterialOverviewResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  processing_daily_report_api_team_materials__team_id__processing_daily_get: {
    parameters: {
      query?: {
        date_from?: string | null
        date_to?: string | null
        page?: number
        page_size?: number
        processing_task_id?: number | null
        processor_id?: number | null
        purpose_id?: number | null
        query?: string | null
        urgent_only?: boolean
        work_date?: string | null
        work_kind?: ('initial' | 'rework') | null
      }
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['PageResponse_ProcessingDailyResponse_']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  list_processing_records_api_team_materials__team_id__processing_records_get: {
    parameters: {
      query?: {
        date_from?: string | null
        date_to?: string | null
        page?: number
        page_size?: number
        processing_task_id?: number | null
        processor_id?: number | null
        purpose_id?: number | null
        query?: string | null
        urgent_only?: boolean
        work_date?: string | null
        work_kind?: ('initial' | 'rework') | null
      }
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ProcessingRecordPageResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  processing_sources_api_team_materials__team_id__processing_stock_get: {
    parameters: {
      query?: {
        group_id?: number | null
        page?: number
        page_size?: number
        query?: string | null
        rework_record_id?: number | null
      }
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['PageResponse_StockBatchResponse_']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  list_processing_tasks_api_team_materials__team_id__processing_tasks_get: {
    parameters: {
      query?: never
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TeamProcessingTaskResponse'][]
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  create_processing_task_api_team_materials__team_id__processing_tasks_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['DirectoryItemInput']
      }
    }
    responses: {
      /** @description Successful Response */
      201: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TeamProcessingTaskResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  update_processing_task_api_team_materials__team_id__processing_tasks__task_id__patch: {
    parameters: {
      query?: never
      header?: never
      path: {
        task_id: number
        team_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['DirectoryItemInput']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TeamProcessingTaskResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  list_purposes_api_team_materials__team_id__purposes_get: {
    parameters: {
      query?: never
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TeamDirectoryItemResponse'][]
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  create_purpose_api_team_materials__team_id__purposes_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['DirectoryItemInput']
      }
    }
    responses: {
      /** @description Successful Response */
      201: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TeamDirectoryItemResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  update_purpose_api_team_materials__team_id__purposes__purpose_id__patch: {
    parameters: {
      query?: never
      header?: never
      path: {
        purpose_id: number
        team_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['DirectoryItemInput']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TeamDirectoryItemResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  change_quantity_api_team_materials__team_id__quantity_adjustments_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['AdjustmentCreate']
      }
    }
    responses: {
      /** @description Successful Response */
      201: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['QuantityAdjustmentResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  list_team_receipts_api_team_materials__team_id__receipts_get: {
    parameters: {
      query?: {
        date_from?: string | null
        date_to?: string | null
        material_type?: string | null
        page?: number
        page_size?: number
        query?: string | null
        receipt_source?: string | null
        urgent_only?: boolean
      }
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['MaterialTransferList']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  create_warehouse_receipt_api_team_materials__team_id__receipts_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['WarehouseReceiptCreate']
      }
    }
    responses: {
      /** @description Successful Response */
      201: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['MaterialTransferResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  history_api_team_materials__team_id__serial_history_get: {
    parameters: {
      query: {
        date_from?: string | null
        date_to?: string | null
        serial_no: string
      }
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['SerialHistory']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  list_serial_reallocations_api_team_materials__team_id__serial_reallocations_get: {
    parameters: {
      query?: {
        date_from?: string | null
        date_to?: string | null
        material_type?: string | null
        page?: number
        page_size?: number
        query?: string | null
        urgent_only?: boolean
      }
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['MaterialTransferList']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  reallocate_serial_api_team_materials__team_id__serial_reallocations_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['ReallocationCreate']
      }
    }
    responses: {
      /** @description Successful Response */
      201: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['MaterialTransferResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  serials_endpoint_api_team_materials__team_id__serials_get: {
    parameters: {
      query?: {
        activity_day?: string | null
        activity_kind?: ('incoming' | 'outgoing' | 'loss') | null
        availability?: 'all' | 'available' | 'scrap'
        date_from?: string | null
        date_to?: string | null
        days?: 7 | 30
        flow_direction?: ('incoming' | 'outgoing') | null
        has_loss?: boolean
        material_name?: string | null
        material_type?: string | null
        page?: number
        page_size?: number
        peer?: string | null
        query?: string | null
        search_field?:
          | 'all'
          | 'serial_no'
          | 'material_name'
          | 'product_code'
          | 'customer_code'
          | 'transfer_specification'
          | 'finished_specification'
          | 'available_quantity'
          | 'available_weight'
          | 'finished_quantity'
          | 'pending_incoming_quantity'
          | 'pending_incoming_weight'
          | 'pending_outgoing_quantity'
          | 'pending_outgoing_weight'
          | 'lost_quantity'
          | 'lost_weight'
          | 'scrap_quantity'
          | 'scrap_weight'
          | 'urgency'
          | 'last_activity_at'
        search_operator?: 'eq' | 'gte' | 'lte'
        serial_no?: string | null
        stock_age?: ('lt1' | '1_3' | '3_7' | 'ge7') | null
        urgent_only?: boolean
        waiting_age?: ('lt1' | '1_3' | '3_7' | 'ge7') | null
        waiting_direction?: ('incoming' | 'outgoing') | null
      }
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['PageResponse_SerialSummaryResponse_']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  list_stock_api_team_materials__team_id__stock_get: {
    parameters: {
      query?: {
        availability?: string
        date_from?: string | null
        date_to?: string | null
        location_status?: string | null
        material_type?: string | null
        page?: number
        page_size?: number
        query?: string | null
        serial_no?: string | null
        source_ids?: string | null
        urgent_only?: boolean
      }
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['StockPageResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  quantity_context_api_team_materials__team_id__stock__lot_id__quantity_adjustments_get: {
    parameters: {
      query?: {
        page?: number
        page_size?: number
      }
      header?: never
      path: {
        lot_id: number
        team_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['QuantityAdjustmentContextResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  warehouse_locations_api_team_materials__team_id__warehouse_locations_get: {
    parameters: {
      query?: {
        limit?: number
        material_name?: string | null
        material_type?: string | null
        query?: string | null
        selected?: string | null
        serial_no?: string | null
      }
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['WarehouseLocationPage']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  list_teams_api_teams_get: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TeamResponse'][]
        }
      }
    }
  }
  create_team_api_teams_post: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['TeamCreate']
      }
    }
    responses: {
      /** @description Successful Response */
      201: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TeamResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  get_team_api_teams__team_id__get: {
    parameters: {
      query?: never
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TeamResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  delete_team_api_teams__team_id__delete: {
    parameters: {
      query?: never
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      204: {
        headers: {
          [name: string]: unknown
        }
        content?: never
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  update_team_api_teams__team_id__patch: {
    parameters: {
      query?: never
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['TeamUpdate']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TeamResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  upload_document_api_teams__team_id__receipt_documents_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        team_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'multipart/form-data': components['schemas']['Body_upload_document_api_teams__team_id__receipt_documents_post']
      }
    }
    responses: {
      /** @description Successful Response */
      201: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ReceiptDocumentResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  read_amendment_api_transfer_amendments__amendment_id__get: {
    parameters: {
      query?: never
      header?: never
      path: {
        amendment_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TransferAmendmentResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  approve_api_transfer_amendments__amendment_id__approve_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        amendment_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TransferAmendmentResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  cancel_api_transfer_amendments__amendment_id__cancel_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        amendment_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TransferAmendmentResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  reject_api_transfer_amendments__amendment_id__reject_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        amendment_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['AmendmentReject']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TransferAmendmentResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  list_users_api_users_get: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['UserResponse'][]
        }
      }
    }
  }
  create_user_api_users_post: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['UserCreate']
      }
    }
    responses: {
      /** @description Successful Response */
      201: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['UserResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  get_user_api_users__user_id__get: {
    parameters: {
      query?: never
      header?: never
      path: {
        user_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['UserResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  delete_user_api_users__user_id__delete: {
    parameters: {
      query?: never
      header?: never
      path: {
        user_id: number
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      204: {
        headers: {
          [name: string]: unknown
        }
        content?: never
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  update_user_api_users__user_id__patch: {
    parameters: {
      query?: never
      header?: never
      path: {
        user_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['UserUpdate']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['UserResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  catalog_api_warehouse_locations_get: {
    parameters: {
      query?: {
        page?: number
        page_size?: number
        query?: string | null
        state?: ('occupied' | 'available' | 'pending' | 'draft' | 'disabled') | null
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['WarehouseLocationPage']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  create_api_warehouse_locations_post: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['LocationWrite']
      }
    }
    responses: {
      /** @description Successful Response */
      201: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['WarehouseLocationResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  edit_api_warehouse_locations__location_id__patch: {
    parameters: {
      query?: never
      header?: never
      path: {
        location_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['LocationWrite']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['WarehouseLocationResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  assign_api_warehouse_locations__location_id__placement_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        location_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['PlacementWrite']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['WarehouseLocationResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  claim_api_warehouse_locations__location_id__reservation_post: {
    parameters: {
      query?: never
      header?: never
      path: {
        location_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['LeaseRequest']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['WarehouseLeaseResponse']
        }
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
  unclaim_api_warehouse_locations__location_id__reservation_delete: {
    parameters: {
      query?: never
      header?: never
      path: {
        location_id: number
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['LeaseRequest']
      }
    }
    responses: {
      /** @description Successful Response */
      204: {
        headers: {
          [name: string]: unknown
        }
        content?: never
      }
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HTTPValidationError']
        }
      }
    }
  }
}
