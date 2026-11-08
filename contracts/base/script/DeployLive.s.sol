// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {AiOracle} from "../src/AiOracle.sol";
import {Dispute} from "../src/Dispute.sol";

contract DeployLive is Script {
    function run() external {
        address oracle = vm.envAddress("ORACLE_ADDRESS");
        address owner = vm.envAddress("OWNER_ADDRESS");
        address counterparty = vm.envOr("COUNTERPARTY_ADDRESS", owner);
        uint256 stake = vm.envOr("STAKE_WEI", uint256(0.001 ether));
        string memory question = vm.envString("QUESTION");
        uint64 timeout = uint64(vm.envOr("DISPUTE_TIMEOUT", uint256(1 days)));
        vm.startBroadcast(owner);
        AiOracle aiOracle = new AiOracle(oracle, owner);
        Dispute dispute = new Dispute(address(aiOracle), timeout);
        uint256 id = dispute.openDispute{value: stake}(question, counterparty);
        vm.stopBroadcast();
        console.log("AiOracle", address(aiOracle));
        console.log("Dispute", address(dispute));
        console.log("requestId", id);
        console.log("questionHash");
        console.logBytes32(keccak256(bytes(question)));
    }
}
