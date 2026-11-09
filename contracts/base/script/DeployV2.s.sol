// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {AiOracle} from "../src/AiOracle.sol";
import {Dispute} from "../src/Dispute.sol";

contract DeployV2 is Script {
    uint256 internal constant BASE_SEPOLIA = 84532;
    uint256 internal constant ARBITRUM_SEPOLIA = 421614;
    uint256 internal constant LOCAL_SIMULATION = 31337;
    uint256 internal constant MAX_TIMEOUT = 7 days;

    error OracleMismatch(address expected, address actual);
    error WrongChain(uint256 chainId);
    error TimeoutOutOfRange(uint256 timeout);

    function run() external returns (AiOracle aiOracle, Dispute dispute) {
        address oracle = vm.envAddress("ORACLE_ADDRESS");
        address owner = vm.envAddress("OWNER_ADDRESS");
        uint256 fee = vm.envUint("FEE_WEI");
        uint256 minStake = vm.envUint("MIN_STAKE_WEI");
        uint256 timeoutRaw = vm.envUint("DISPUTE_TIMEOUT");

        bool testnet = block.chainid == BASE_SEPOLIA || block.chainid == ARBITRUM_SEPOLIA;
        if (!testnet && block.chainid != LOCAL_SIMULATION) revert WrongChain(block.chainid);
        if (timeoutRaw == 0 || timeoutRaw > MAX_TIMEOUT) revert TimeoutOutOfRange(timeoutRaw);
        uint64 timeout = uint64(timeoutRaw);

        vm.startBroadcast();
        aiOracle = new AiOracle(oracle, owner, fee);
        dispute = new Dispute(address(aiOracle), timeout, minStake);
        vm.stopBroadcast();

        if (aiOracle.oracle() != oracle) revert OracleMismatch(oracle, aiOracle.oracle());

        console.log("AiOracle", address(aiOracle));
        console.log("Dispute", address(dispute));
        console.log("oracle", oracle);
        console.log("owner", owner);
        console.log("fee", fee);
        console.log("minStake", minStake);
        console.log("timeout", uint256(timeout));
    }
}
